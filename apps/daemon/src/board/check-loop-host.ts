/**
 * Issue #1523 (the board split): the board's side of the check loop (issue #1361). It owns the
 * engine, the card's switch, the rounds table and how the loop shows on a card; it reaches the
 * board only through the port below.
 */
import type { Database } from "bun:sqlite";
import { CheckLoopReason } from "@flightdeck/protocol";
import { runChecks } from "../watch/check-run.ts";
import type { WorkflowEngine } from "../workflows/engine.ts";
import { cardMode } from "./check-loop.ts";
import {
  CheckLoopEngine,
  type LoopCard,
  type RoundRecord,
  roundsCap,
} from "./check-loop-engine.ts";
import type { BoardEvent } from "./columns.ts";
import type { BoardOptions, Card, CardRow, Project } from "./types.ts";

const now = () => new Date().toISOString();

/** What the check loop needs of the board. */
export interface CheckLoopHostPort {
  db: Database;
  opts: Pick<BoardOptions, "manager" | "checkLoop" | "quota" | "memory" | "log">;
  workflows: Pick<WorkflowEngine, "has">;
  card(id: string): Card;
  project(id: string): Project;
  budgetBlocked(projectId: string): boolean;
  release(cardId: string): void;
  place(cardId: string, event: BoardEvent): void;
  changed(id: string): Card;
}

export class CheckLoopHost {
  /** The check loop's state machine; null when the host runs no check loop. */
  readonly engine: CheckLoopEngine | null;
  /** Projects whose watch settings could not be read, logged once each. */
  private readonly unreadableSettings = new Set<string>();

  constructor(private readonly port: CheckLoopHostPort) {
    this.engine = port.opts.checkLoop ? this.build(port.opts.checkLoop) : null;
  }

  /**
   * Stores the card's check loop switch; the decision is `CheckLoopSwitch`'s
   * (board/check-loop.ts). A switch turned off forgets its confirmation.
   */
  store(
    id: string,
    value: {
      on: boolean;
      rounds: number | null;
      confirmedAt: string | null;
      confirmedHash: string | null;
    },
  ): Card {
    const card = this.port.card(id);
    // Switched on: the session's events so far are history, never a turn for the loop to check.
    // Read before anything is written: a session that cannot be read throws here, so the switch is
    // never saved without its mark.
    const switching = value.on && card.checkLoop?.on !== true;
    const mark =
      switching && card.sessionId ? this.port.opts.manager.get(card.sessionId).lastSeq : null;
    const { db } = this.port;
    db.transaction(() => {
      db.query(
        `UPDATE cards SET check_loop = ?, check_rounds = ?, check_loop_confirmed_at = ?,
           check_loop_confirmed_hash = ? WHERE id = ?`,
      ).run(value.on ? 1 : 0, value.rounds, value.confirmedAt, value.confirmedHash, id);
      if (switching) {
        db.query("UPDATE cards SET check_loop_turn_seq = ? WHERE id = ?").run(mark, id);
      }
    })();
    return this.port.changed(id);
  }

  /** The card's switch and how its loop goes, for the app. */
  of(row: CardRow): Card["checkLoop"] {
    const own = {
      on: row.check_loop === 1,
      rounds: row.check_rounds,
      confirmed: row.check_loop_confirmed_at !== null,
    };
    // Every card read comes here: a card with the switch off asks the rounds table nothing.
    if (!own.on) return own;
    const last = this.port.db
      .query<
        {
          status: "sent" | "ended";
          reason: string | null;
          command: string | null;
          exit_code: number | null;
          at: string;
        },
        [string]
      >(
        "SELECT status, reason, command, exit_code, at FROM card_check_rounds WHERE card_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(row.id);
    // A board that starts before its watch settings can be read shows the loop without its cap.
    let project: number | undefined;
    try {
      project = this.port.opts.checkLoop?.settings(row.project_id).checkRounds;
    } catch (error) {
      project = undefined;
      // Said once per project: a row that cannot be read would otherwise go unnoticed.
      if (!this.unreadableSettings.has(row.project_id)) {
        this.unreadableSettings.add(row.project_id);
        const what = error instanceof Error ? error.name : "error";
        this.port.opts.log?.(
          `check loop: the watch settings of project ${row.project_id} could not be read (${what})`,
        );
      }
    }
    const max = project === undefined ? undefined : roundsCap(row.check_rounds, project);
    const reason = CheckLoopReason.safeParse(last?.reason);
    return {
      ...own,
      active: this.engine?.phaseOf(row.id) ?? null,
      round: this.engine?.sentOf(row.id) ?? 0,
      ...(max === undefined ? {} : { max }),
      last: last
        ? {
            state: last.status,
            reason: reason.success ? reason.data : null,
            command: last.command,
            exitCode: last.exit_code,
            at: last.at,
          }
        : null,
    };
  }

  /** Rounds a restart left open are closed as interrupted, one end line each. */
  sweep(): void {
    const { db } = this.port;
    const open = db
      .query<{ card_id: string; run_id: string; n: number }, []>(
        `SELECT card_id, run_id, n FROM card_check_rounds r
         WHERE status = 'sent' AND id = (SELECT MAX(id) FROM card_check_rounds WHERE card_id = r.card_id)`,
      )
      .all();
    for (const row of open) {
      db.query(
        `INSERT INTO card_check_rounds (card_id, run_id, n, at, status, reason)
           VALUES (?, ?, ?, ?, 'ended', 'interrupted')`,
      ).run(row.card_id, row.run_id, row.n, now());
    }
  }

  /** The loop's effects on this board. */
  private build(options: NonNullable<BoardOptions["checkLoop"]>): CheckLoopEngine {
    const { port } = this;
    return new CheckLoopEngine({
      card: (cardId) => this.loopCard(cardId),
      settings: (projectId) => options.settings(projectId),
      mode: (cardId) => cardMode(port.card(cardId), port.opts.manager),
      trusted: (cardId) => options.isTrusted(port.project(port.card(cardId).projectId).path),
      limit: (cardId) => this.limit(cardId),
      runChecks: (input) => runChecks({ ...input, runner: options.runner }),
      // The round goes into the session as the board's own write, never through a person's command.
      send: (cardId, text) => {
        const { sessionId } = port.card(cardId);
        if (sessionId) port.opts.manager.send(sessionId, text);
      },
      release: (cardId) => port.release(cardId),
      place: (cardId) => port.place(cardId, { type: "turn", isError: false }),
      record: (cardId, record) => this.record(cardId, record),
      notify: (cardId) => port.changed(cardId),
      timer: {
        set: (fn, ms) => setTimeout(fn, ms),
        clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
    });
  }

  /** What the loop needs of a card; null when the card is gone. */
  private loopCard(cardId: string): LoopCard | null {
    const { db } = this.port;
    const row = db
      .query<
        {
          loop_on: number;
          rounds: number | null;
          hash: string | null;
          worktree: string | null;
          project: string;
        },
        [string]
      >(
        `SELECT check_loop AS loop_on, check_rounds AS rounds, check_loop_confirmed_hash AS hash,
         worktree_path AS worktree, project_id AS project FROM cards WHERE id = ?`,
      )
      .get(cardId);
    if (!row) return null;
    const run = db
      .query<{ id: string; fix_prompt: string | null }, [string]>(
        "SELECT id, fix_prompt FROM card_runs WHERE card_id = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(cardId);
    // A watch's fixing run and a workflow run have checks of their own.
    const plainRun = run !== null && run.fix_prompt === null && !this.port.workflows.has(run.id);
    return {
      on: row.loop_on === 1,
      rounds: row.rounds,
      confirmedHash: row.hash,
      plainRun,
      worktree: row.worktree,
      projectId: row.project,
    };
  }

  /** The limit that stops a round now: the quota, the host's memory, or the project's budget. */
  private limit(cardId: string): "budget" | "quota" | "memory" | null {
    const { opts } = this.port;
    if (opts.quota?.blocked()) return "quota";
    if (opts.memory?.blocked()) return "memory";
    return this.port.budgetBlocked(this.port.card(cardId).projectId) ? "budget" : null;
  }

  /** One line of a card's loop: a round sent, or the loop's end with its reason. */
  private record(cardId: string, record: RoundRecord): void {
    const { db } = this.port;
    const run = db
      .query<{ id: string }, [string]>(
        "SELECT id FROM card_runs WHERE card_id = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(cardId);
    db.query(
      `INSERT INTO card_check_rounds
         (card_id, run_id, n, at, status, reason, command, exit_code, timed_out)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      cardId,
      run?.id ?? "",
      record.n,
      now(),
      record.status,
      record.reason ?? null,
      record.command ?? null,
      record.exitCode ?? null,
      record.timedOut ? 1 : 0,
    );
    this.port.changed(cardId);
  }
}
