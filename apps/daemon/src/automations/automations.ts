/**
 * Phase 13: automations by time and by event. Every one is born off and is turned on with a
 * confirmation; each firing is recorded, a failed one never repeats on its own, and content from
 * a third party is ignored unless the automation allows it, in which case it goes marked as
 * untrusted and the automatic approval stays suspended on that card.
 */
import type { Database } from "bun:sqlite";
import type { Automation, AutomationRun, Issue } from "@flightdeck/protocol";
import type { Board } from "../board/board.ts";
import { FlightdeckError } from "../errors.ts";
import { type Issues, UNTRUSTED_MARK } from "../issues/issues.ts";
import type { AutoApprover } from "../permissions/auto-approve.ts";
import { localDay } from "../quota/usage.ts";
import { ulid } from "../ulid.ts";
import { type CronSpec, cronMatches, parseCron, validTimeZone } from "./cron.ts";

export type AutomationEvent =
  | {
      type: "pr_comment";
      cardId: string;
      commentId: string;
      author: string;
      text: string;
      /** Third party: not you, and not an owner, member or collaborator. */
      external: boolean;
    }
  | { type: "ci_failed"; cardId: string; key: string; summary: string }
  | { type: "issue_label"; projectId: string; issue: Issue }
  | { type: "cron"; projectId: string; automationId: string; minute: number };

export interface AutomationInput {
  projectId: string;
  id?: string | undefined;
  name: string;
  trigger: Automation["trigger"];
  action: Automation["action"];
  maxRunsPerDay?: number | undefined;
  allowExternalAuthors?: boolean | undefined;
}

export interface AutomationsOptions {
  db: Database;
  board: Board;
  issues: Pick<Issues, "list" | "createCard">;
  autoApprove?: Pick<AutoApprover, "suspend">;
  /** Milliseconds now; `Date.now` when absent. */
  clock?: () => number;
  /** `YYYY-MM-DD` of an instant, for the daily limit; the host's time zone when absent. */
  day?: (ms: number) => string;
  /** The scheduler's interval (a minute when absent). */
  tickMs?: number | undefined;
  /** The issue search's interval (5 minutes when absent). */
  pollMs?: number | undefined;
  log?: (message: string) => void;
}

interface Row {
  id: string;
  project_id: string;
  name: string;
  enabled: number;
  trigger: string;
  action: string;
  max_runs_per_day: number;
  allow_external_authors: number;
  created_at: string;
}

interface RunRow {
  id: string;
  automation_id: string;
  fired_at: string;
  cause: string;
  status: AutomationRun["status"];
  detail: string | null;
}

const MINUTE = 60_000;
/** A slot this recent is still fired by a late tick; an older one was missed. */
const GRACE = 2 * MINUTE;
/** How far back a tick or a boot looks for missed slots. */
const WINDOW = 7 * 24 * 60 * MINUTE;
/** Missed slots recorded per automation: the latest ones. */
const MAX_MISSED = 10;

const bad = (message: string) => new FlightdeckError("bad_request", message);

const toAutomation = (row: Row): Automation => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  enabled: row.enabled === 1,
  trigger: JSON.parse(row.trigger),
  action: JSON.parse(row.action),
  maxRunsPerDay: row.max_runs_per_day,
  allowExternalAuthors: row.allow_external_authors === 1,
  createdAt: row.created_at,
});

const toRun = (row: RunRow): AutomationRun => ({
  id: row.id,
  automationId: row.automation_id,
  firedAt: row.fired_at,
  cause: row.cause,
  status: row.status,
  detail: row.detail,
});

/** What happened, for the run's history. */
function causeOf(event: AutomationEvent): string {
  switch (event.type) {
    case "cron":
      return `agendamento de ${new Date(event.minute).toISOString()}`;
    case "pr_comment":
      return `comentário ${event.commentId} de ${event.author} no PR do card ${event.cardId}`;
    case "ci_failed":
      return `checks do PR do card ${event.cardId} falharam`;
    case "issue_label":
      return `issue ${event.issue.ref} com o rótulo ${event.issue.labels.join(", ")}`;
  }
}

/** One event fires an automation once: the same comment, issue or slot never repeats. */
function keyOf(event: AutomationEvent): string {
  switch (event.type) {
    case "cron":
      return `cron:${event.minute}`;
    case "pr_comment":
      return `comment:${event.commentId}`;
    case "ci_failed":
      return `ci:${event.key}`;
    case "issue_label":
      return `issue:${event.issue.ref}`;
  }
}

const isExternal = (event: AutomationEvent) =>
  (event.type === "pr_comment" && event.external) ||
  (event.type === "issue_label" && event.issue.external);

/** What the agent is told about the event; empty for a time-based one. */
function contentOf(event: AutomationEvent): string {
  if (event.type === "pr_comment") return `Comentário de ${event.author} no PR:\n${event.text}`;
  if (event.type === "ci_failed") return `Os checks do PR falharam: ${event.summary}`;
  return "";
}

type Outcome = { status: "ok" | "skipped"; detail: string };

export class Automations {
  private readonly db: Database;
  private readonly clock: () => number;
  private readonly day: (ms: number) => string;
  private readonly specs = new Map<string, CronSpec>();
  /** The minute tick, while a cron automation is on; the issue search, while an issue one is. */
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private unwatchChecks: () => void = () => {};
  /** The search and the tick in progress, so `idle` can wait for them. */
  private searching: Promise<void> | null = null;
  private ticking: Promise<void> | null = null;

  constructor(private readonly opts: AutomationsOptions) {
    this.db = opts.db;
    this.clock = opts.clock ?? Date.now;
    this.day = opts.day ?? localDay;
  }

  list(projectId: string): Automation[] {
    return this.db
      .query<Row, [string]>(
        "SELECT * FROM automations WHERE project_id = ? ORDER BY created_at, rowid",
      )
      .all(projectId)
      .map(toAutomation);
  }

  /** Creates or edits an automation. It always ends up off: turning it on is a decision. */
  save(input: AutomationInput): Automation {
    this.opts.board.getProject(input.projectId);
    const existing = input.id ? this.row(input.id) : null;
    if (input.id && !existing) {
      throw new FlightdeckError("not_found", `automação ${input.id} não existe`);
    }
    if (!input.name.trim()) throw bad("a automação precisa de um nome");
    const max = input.maxRunsPerDay ?? existing?.max_runs_per_day ?? 10;
    if (!Number.isInteger(max) || max < 1) throw bad("maxRunsPerDay é um inteiro de 1 em diante");
    this.check(input.trigger, input.action);
    const id = existing?.id ?? ulid();
    this.db
      .query(
        `INSERT INTO automations (id, project_id, name, enabled, trigger, action, max_runs_per_day,
           allow_external_authors, created_at)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, enabled = 0,
           trigger = excluded.trigger, action = excluded.action,
           max_runs_per_day = excluded.max_runs_per_day,
           allow_external_authors = excluded.allow_external_authors`,
      )
      .run(
        id,
        input.projectId,
        input.name.trim(),
        JSON.stringify(input.trigger),
        JSON.stringify(input.action),
        max,
        (input.allowExternalAuthors ?? existing?.allow_external_authors === 1) ? 1 : 0,
        existing?.created_at ?? new Date(this.clock()).toISOString(),
      );
    this.specs.delete(id);
    this.arm();
    return toAutomation(this.row(id) as Row);
  }

  remove(id: string, confirm: boolean): Automation[] {
    if (!confirm)
      throw new FlightdeckError("invalid_state", "remover a automação pede confirm: true");
    const row = this.row(id);
    if (!row) throw new FlightdeckError("not_found", `automação ${id} não existe`);
    for (const table of ["automation_runs", "automation_seen"]) {
      this.db.query(`DELETE FROM ${table} WHERE automation_id = ?`).run(id);
    }
    this.db.query("DELETE FROM automations WHERE id = ?").run(id);
    this.specs.delete(id);
    this.arm();
    return this.list(row.project_id);
  }

  /** Turning on needs a confirmation (the app shows the trigger and the action first). */
  toggle(id: string, enabled: boolean, confirm: boolean): Automation {
    if (enabled && !confirm) {
      throw new FlightdeckError("invalid_state", "ligar a automação pede confirm: true");
    }
    if (!this.row(id)) throw new FlightdeckError("not_found", `automação ${id} não existe`);
    this.db.query("UPDATE automations SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
    this.arm();
    return toAutomation(this.row(id) as Row);
  }

  /** The newest runs first. */
  runs(id: string, limit = 100): AutomationRun[] {
    return this.db
      .query<RunRow, [string, number]>(
        "SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY fired_at DESC, rowid DESC LIMIT ?",
      )
      .all(id, limit)
      .map(toRun);
  }

  /** The PR's checks turned to failing: the source is the board's PR polling. */
  onChecksFailing(cardId: string, failed: string[]): void {
    const summary = failed.length > 0 ? failed.join(", ") : "os checks do PR falharam";
    void this.fire({ type: "ci_failed", cardId, key: ulid(), summary }).catch((error: Error) =>
      this.opts.log?.(`automações: ci_failed do card ${cardId}: ${error.message}`),
    );
  }

  /** Runs every enabled automation of the event, one at a time. */
  async fire(event: AutomationEvent): Promise<void> {
    const projectId = this.projectOf(event);
    if (!projectId) return;
    const matching = this.enabled().filter(
      (auto) =>
        auto.projectId === projectId &&
        (event.type === "cron"
          ? auto.id === event.automationId
          : auto.trigger.type === event.type &&
            (event.type !== "issue_label" ||
              (auto.trigger.type === "issue_label" &&
                event.issue.labels.includes(auto.trigger.label)))),
    );
    for (const auto of matching) await this.run(auto, event);
  }

  /** Fires the cron automations whose minute has come; slots that went by unseen are missed. */
  async tick(now: number): Promise<void> {
    // A tick that finds another one running leaves its minutes to the next: they are scanned
    // from the last minute seen.
    if (this.ticking) return;
    this.ticking = this.advance(now, true).finally(() => {
      this.ticking = null;
    });
    await this.ticking;
  }

  /** The search of issues for `issue_label` automations, one list per project. */
  async pollIssues(): Promise<void> {
    // One search at a time: a slow CLI must not pile searches up under a short interval.
    if (this.searching) return;
    this.searching = this.search().finally(() => {
      this.searching = null;
    });
    await this.searching;
  }

  private async search(): Promise<void> {
    const projects = new Set(
      this.enabled()
        .filter((auto) => auto.trigger.type === "issue_label")
        .map((auto) => auto.projectId),
    );
    for (const projectId of projects) {
      let issues: Issue[];
      try {
        issues = await this.opts.issues.list(projectId);
      } catch (error) {
        this.opts.log?.(
          `automações: a busca de issues do projeto ${projectId} falhou: ${(error as Error).message}`,
        );
        continue;
      }
      for (const issue of issues) await this.fire({ type: "issue_label", projectId, issue });
    }
  }

  /**
   * Slots that came up while the daemon was stopped are only recorded as missed, never run; then
   * the scheduler and the issue search start.
   */
  start(): void {
    void this.advance(this.clock(), false);
    this.unwatchChecks = this.opts.board.onChecksFailing((cardId, failed) =>
      this.onChecksFailing(cardId, failed),
    );
    this.started = true;
    this.arm(false);
  }

  /**
   * Each timer runs only while an automation needs it: the minute tick for a cron one, the issue
   * search for an `issue_label` one. A tick that starts later (the first cron automation was just
   * turned on) starts from this minute: the time before it was nobody's slot to miss.
   */
  private arm(afterStart = true): void {
    const on = this.started ? this.enabled() : [];
    const wantTick = on.some((auto) => auto.trigger.type === "cron");
    const wantPoll = on.some((auto) => auto.trigger.type === "issue_label");
    if (wantTick && this.tickTimer === null) {
      if (afterStart) this.markClock(this.clock());
      this.tickTimer = setInterval(() => void this.tick(this.clock()), this.opts.tickMs ?? MINUTE);
    } else if (!wantTick && this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (wantPoll && this.pollTimer === null) {
      this.pollTimer = setInterval(() => void this.pollIssues(), this.opts.pollMs ?? 5 * MINUTE);
    } else if (!wantPoll && this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Resolves when the tick and the search in progress, if any, are done. */
  async idle(): Promise<void> {
    await Promise.all([this.ticking, this.searching]);
  }

  stop(): void {
    this.started = false;
    this.arm();
    this.unwatchChecks();
    this.unwatchChecks = () => {};
  }

  private markClock(now: number): void {
    this.db
      .query(
        "INSERT INTO automation_clock (id, last_tick) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET last_tick = excluded.last_tick",
      )
      .run(Math.floor(now / MINUTE) * MINUTE);
  }

  /** The minutes since the last one seen, up to `now`: recent ones fire (when `fire`), old ones are missed. */
  private async advance(now: number, fire: boolean): Promise<void> {
    const minute = Math.floor(now / MINUTE) * MINUTE;
    const last = this.db
      .query<{ last_tick: number }, []>("SELECT last_tick FROM automation_clock WHERE id = 1")
      .get()?.last_tick;
    this.db
      .query(
        "INSERT INTO automation_clock (id, last_tick) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET last_tick = excluded.last_tick",
      )
      .run(minute);
    // The very first look has no past: only the current minute can fire.
    const from = last === undefined ? minute : Math.max(last + MINUTE, minute - WINDOW);
    const crons = this.enabled().filter((auto) => auto.trigger.type === "cron");
    for (const auto of crons) {
      const spec = this.spec(auto);
      const zone = (auto.trigger as { tz: string }).tz;
      const missed: number[] = [];
      for (let slot = from; slot <= minute; slot += MINUTE) {
        if (!cronMatches(spec, zone, slot)) continue;
        if (fire && minute - slot <= GRACE) {
          await this.fire({
            type: "cron",
            projectId: auto.projectId,
            automationId: auto.id,
            minute: slot,
          });
        } else if (last !== undefined) {
          missed.push(slot);
        }
      }
      for (const slot of missed.slice(-MAX_MISSED)) {
        this.record(
          auto,
          slot,
          `agendamento perdido de ${new Date(slot).toISOString()}`,
          "missed",
          "o daemon estava parado",
        );
      }
    }
  }

  private async run(auto: Automation, event: AutomationEvent): Promise<void> {
    const seen = this.db
      .query("INSERT OR IGNORE INTO automation_seen (automation_id, key) VALUES (?, ?)")
      .run(auto.id, keyOf(event));
    if (seen.changes === 0) return;
    const at = event.type === "cron" ? event.minute : this.clock();
    const cause = causeOf(event);
    if (isExternal(event) && !auto.allowExternalAuthors) {
      this.record(
        auto,
        at,
        cause,
        "ignored",
        "autor externo: a automação não age sobre conteúdo de terceiros",
      );
      return;
    }
    if (this.today(auto.id, at) >= auto.maxRunsPerDay) {
      this.record(auto, at, cause, "limited", `limite de ${auto.maxRunsPerDay} execuções por dia`);
      return;
    }
    try {
      const outcome = await this.act(auto, event);
      this.record(auto, at, cause, outcome.status, outcome.detail);
    } catch (error) {
      this.record(auto, at, cause, "failed", (error as Error).message);
    }
  }

  private async act(auto: Automation, event: AutomationEvent): Promise<Outcome> {
    const { board } = this.opts;
    const { action } = auto;
    if (action.type === "create_card") {
      // Saved only with an issue_label trigger (see `check`), so this event always has an issue.
      const { issue } = event as Extract<AutomationEvent, { type: "issue_label" }>;
      return this.cardFromIssue(auto, issue, async (card) => `card ${card}`);
    }
    if (action.type === "start_workflow") {
      const inputs = action.inputs;
      const start = async (cardId: string) => {
        await board.startCard(cardId, { workflow: action.workflow, ...(inputs ? { inputs } : {}) });
        return `card ${cardId}`;
      };
      if (event.type === "issue_label") return this.cardFromIssue(auto, event.issue, start);
      const external = isExternal(event);
      const content = contentOf(event);
      const description = [action.description ?? "", external ? UNTRUSTED_MARK : "", content]
        .filter((part) => part.trim() !== "")
        .join("\n\n");
      const projectId = auto.projectId;
      const card = board.createCard(projectId, { title: action.title ?? auto.name, description });
      if (external) this.suspend(card.id);
      try {
        return { status: "ok", detail: await start(card.id) };
      } catch (error) {
        // A card that never started has nothing to keep: no orphan in the Backlog.
        await board.discardCard(card.id, true);
        throw error;
      }
    }
    if (!("cardId" in event)) return { status: "skipped", detail: "o evento não é de um card" };
    const external = isExternal(event);
    const text = external ? `${UNTRUSTED_MARK}\n\n${contentOf(event)}` : contentOf(event);
    board.message(event.cardId, text);
    if (external) this.suspend(event.cardId);
    return { status: "ok", detail: `enviado ao card ${event.cardId}` };
  }

  /** The card of an issue, made now; an issue that already has one is skipped. */
  private async cardFromIssue(
    auto: Automation,
    issue: Issue,
    then: (cardId: string) => Promise<string>,
  ): Promise<Outcome> {
    const existing = this.opts.board.cardForIssue(auto.projectId, issue.ref);
    if (existing)
      return { status: "skipped", detail: `a issue ${issue.ref} já tem o card ${existing}` };
    const card = await this.opts.issues.createCard(auto.projectId, issue.ref);
    return { status: "ok", detail: await then(card.id) };
  }

  /** Content from a third party reached the card: nothing there is approved automatically. */
  private suspend(cardId: string): void {
    this.opts.autoApprove?.suspend(
      `card:${cardId}`,
      "conteúdo de terceiro enviado por uma automação",
    );
  }

  /** Runs that count against the daily limit: those that acted, or tried to. */
  private today(id: string, at: number): number {
    const day = this.day(at);
    return this.db
      .query<{ fired_at: string }, [string]>(
        "SELECT fired_at FROM automation_runs WHERE automation_id = ? AND status IN ('ok', 'failed') ORDER BY fired_at DESC LIMIT 500",
      )
      .all(id)
      .filter((run) => this.day(Date.parse(run.fired_at)) === day).length;
  }

  private record(
    auto: Automation,
    at: number,
    cause: string,
    status: AutomationRun["status"],
    detail: string | null,
  ): void {
    this.db
      .query(
        "INSERT INTO automation_runs (id, automation_id, fired_at, cause, status, detail) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(ulid(), auto.id, new Date(at).toISOString(), cause, status, detail);
  }

  private enabled(): Automation[] {
    return this.db
      .query<Row, []>("SELECT * FROM automations WHERE enabled = 1 ORDER BY created_at, rowid")
      .all()
      .map(toAutomation);
  }

  private row(id: string): Row | null {
    return this.db.query<Row, [string]>("SELECT * FROM automations WHERE id = ?").get(id);
  }

  private spec(auto: Automation): CronSpec {
    let spec = this.specs.get(auto.id);
    if (!spec) {
      spec = parseCron((auto.trigger as { expr: string }).expr);
      this.specs.set(auto.id, spec);
    }
    return spec;
  }

  /** The project an event belongs to; null when its card is gone. */
  private projectOf(event: AutomationEvent): string | null {
    if ("projectId" in event) return event.projectId;
    try {
      return this.opts.board.getCard(event.cardId).projectId;
    } catch {
      return null;
    }
  }

  /** Refuses what the automation could never do. */
  private check(trigger: Automation["trigger"], action: Automation["action"]): void {
    if (trigger.type === "cron") {
      try {
        parseCron(trigger.expr);
      } catch (error) {
        throw bad((error as Error).message);
      }
      if (!validTimeZone(trigger.tz)) throw bad(`fuso horário desconhecido: ${trigger.tz}`);
    }
    if (
      action.type === "send_to_card" &&
      trigger.type !== "pr_comment" &&
      trigger.type !== "ci_failed"
    ) {
      throw bad("send_to_card precisa de um gatilho com card: pr_comment ou ci_failed");
    }
    if (action.type === "create_card" && trigger.type !== "issue_label") {
      throw bad("create_card precisa do gatilho issue_label");
    }
  }
}
