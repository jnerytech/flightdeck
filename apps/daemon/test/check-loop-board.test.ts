import { Database } from "bun:sqlite";
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { Board } from "../src/board/board.ts";
import { confirmationHash } from "../src/board/check-loop.ts";
import { startServer } from "../src/server.ts";
import { EventStore } from "../src/store/event-store.ts";
import { MIGRATIONS } from "../src/store/migrations.ts";
import { PrWatcher } from "../src/watch/watch.ts";
import type { BoundedCheckResult } from "../src/workflows/check-runner.ts";
import { cardWhen, newBoard } from "./board-helpers.ts";
import { poll, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

// Real git (a worktree per card): more than the default 5 s.
setDefaultTimeout(30_000);

/**
 * Issue #1361 (slice 1c-2c): the check loop wired into the board. A card with the switch on runs
 * the project's checks when its turn ends, sends a round into the same session when one fails,
 * keeps its run slot meanwhile, and moves to review once they pass
 * (docs/decisions/2026-11-09-check-loop.md).
 */
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const FAILED: BoundedCheckResult = { exitCode: 1, output: "1 failed: login" };
const PASSED: BoundedCheckResult = { exitCode: 0, output: "" };

async function setup(results: BoundedCheckResult[] = [FAILED, PASSED]) {
  const ran: string[] = [];
  const answers = [...results];
  let gate: Promise<void> | null = null;
  let during: (() => void) | null = null;
  const finished: string[] = [];
  /** A killed check takes this long to exit: the test opens it when it says. */
  let killGate: Promise<void> | null = null;
  const runner = {
    run: async (command: string, _cwd: string, _timeoutMs?: number, signal?: AbortSignal) => {
      ran.push(command);
      during?.();
      // A held check ends when it is let go, or when it is killed (its signal aborts).
      if (gate) {
        await Promise.race([
          gate,
          new Promise<void>((done) => signal?.addEventListener("abort", () => done())),
        ]);
      }
      if (signal?.aborted && killGate) await killGate;
      finished.push(signal?.aborted ? "killed" : "done");
      if (signal?.aborted) return { exitCode: 137, output: "", aborted: true };
      return answers.shift() ?? PASSED;
    },
  };
  let watcher: PrWatcher | null = null;
  const ctx = newBoard({
    maxParallelRuns: 1,
    checkLoop: {
      settings: (projectId: string) => (watcher as PrWatcher).settings(projectId),
      isTrusted: () => true,
      runner,
    },
  });
  cleanups.push(() => ctx.board.stop());
  watcher = new PrWatcher({ db: ctx.store.db, board: ctx.board });
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  watcher.setSettings(project.id, { checks: ["bun test"] });
  const card = ctx.board.createCard(project.id, { title: "Login", description: "faça o login" });
  const switchOn = (cardId: string) =>
    ctx.board.storeCheckLoop(cardId, {
      on: true,
      rounds: null,
      confirmedAt: new Date().toISOString(),
      confirmedHash: confirmationHash(["bun test"], [], "default"),
    });
  return {
    ...ctx,
    project,
    card,
    ran,
    finished,
    switchOn,
    duringCheck: (fn: () => void) => (during = fn),
    holdKill: () => {
      let open = () => {};
      killGate = new Promise<void>((done) => (open = done));
      return open;
    },
    holdChecks: () => {
      let open = () => {};
      gate = new Promise<void>((done) => (open = done));
      return () => {
        gate = null;
        open();
      };
    },
    rounds: (cardId: string) => {
      try {
        return ctx.store.db
          .query<{ n: number; status: string; reason: string | null }, [string]>(
            "SELECT n, status, reason FROM card_check_rounds WHERE card_id = ? ORDER BY id",
          )
          .all(cardId);
      } catch {
        // No such table or column yet: no rounds, so the expect below says what is missing.
        return [];
      }
    },
  };
}

/** The text of every user message the card's session got, in order. */
function prompts(ctx: Awaited<ReturnType<typeof setup>>, cardId: string): string[] {
  const sessionId = ctx.board.getCard(cardId).sessionId;
  if (!sessionId) return [];
  return ctx.store
    .eventsSince(sessionId, 0)
    .filter((envelope) => envelope.event.type === "message.user")
    .map((envelope) => String((envelope.event as { text?: string }).text ?? ""));
}

describe("check-loop: on the board", () => {
  test("a failing check sends a round into the same session; once it passes the card goes to review, and a queued card waited for the slot", async () => {
    const ctx = await setup();
    ctx.switchOn(ctx.card.id);
    const other = ctx.board.createCard(ctx.project.id, { title: "Other", description: "d" });
    const queuedWhileChecking: boolean[] = [];
    ctx.duringCheck(() => queuedWhileChecking.push(ctx.board.getCard(other.id).queued));
    await ctx.board.startCard(ctx.card.id);
    await ctx.board.startCard(other.id);
    const reviewed = await cardWhen(ctx.board, ctx.card.id, (c) => c.column === "review");
    const otherRan = await poll(() => ctx.board.getCard(other.id).sessionId !== null, 10_000);
    const sent = prompts(ctx, ctx.card.id);
    expect([
      reviewed !== null,
      ctx.ran,
      queuedWhileChecking,
      sent.length,
      sent.at(-1)?.startsWith("Round 1 of 3: `bun test` failed (exit 1)."),
      ctx.rounds(ctx.card.id).map((row) => [row.n, row.status, row.reason]),
      otherRan,
    ]).toEqual([
      true,
      ["bun test", "bun test"],
      [true, true],
      2,
      true,
      [
        [1, "sent", null],
        [2, "ended", "passed"],
      ],
      true,
    ]);
  });

  test("a card with the switch off moves to review as before, with no check", async () => {
    const ctx = await setup();
    await ctx.board.startCard(ctx.card.id);
    const reviewed = await cardWhen(ctx.board, ctx.card.id, (c) => c.column === "review");
    expect([reviewed !== null, ctx.ran]).toEqual([true, []]);
  });

  test("the person's message while the checks run aborts them: no round is sent", async () => {
    // The held check is killed, so it spends no result; the loop after the person's turn passes.
    const ctx = await setup([PASSED]);
    ctx.switchOn(ctx.card.id);
    const open = ctx.holdChecks();
    await ctx.board.startCard(ctx.card.id);
    await poll(() => ctx.ran.length === 1, 10_000);
    ctx.board.message(ctx.card.id, "deixa que eu vejo");
    open();
    const reviewed = await cardWhen(ctx.board, ctx.card.id, (c) => c.column === "review");
    expect([
      reviewed !== null,
      prompts(ctx, ctx.card.id).some((text) => text.startsWith("Round ")),
      // The person's own turn then ends and starts a fresh loop, whose check passes.
      ctx.rounds(ctx.card.id).map((row) => row.reason),
    ]).toEqual([true, false, ["person_turn", "passed"]]);
  });

  test("stopping the card while its checks run ends the loop and gives the slot back", async () => {
    const ctx = await setup([FAILED]);
    ctx.switchOn(ctx.card.id);
    const open = ctx.holdChecks();
    const other = ctx.board.createCard(ctx.project.id, { title: "Other", description: "d" });
    await ctx.board.startCard(ctx.card.id);
    await ctx.board.startCard(other.id);
    await poll(() => ctx.ran.length === 1, 10_000);
    await ctx.board.stopCard(ctx.card.id);
    open();
    const otherRan = await poll(() => ctx.board.getCard(other.id).sessionId !== null, 10_000);
    expect([otherRan, ctx.rounds(ctx.card.id).at(-1)?.reason]).toEqual([true, "stopped_by_you"]);
  });
});

describe("check-loop: the security review's cases on the board", () => {
  test("reordering the card in its own column does not end the loop", async () => {
    const ctx = await setup([FAILED]);
    ctx.switchOn(ctx.card.id);
    const open = ctx.holdChecks();
    await ctx.board.startCard(ctx.card.id);
    await poll(() => ctx.ran.length === 1, 10_000);
    const column = ctx.board.getCard(ctx.card.id).column;
    await ctx.board.moveByHand(ctx.card.id, column, 0, false);
    open();
    const round = await poll(
      () => prompts(ctx, ctx.card.id).some((text) => text.startsWith("Round 1 of 3")),
      10_000,
    );
    expect([round, ctx.rounds(ctx.card.id)[0]?.status]).toEqual([true, "sent"]);
  });

  test("a new run of the card starts its loop afresh: the mark of an older session does not silence it", async () => {
    const ctx = await setup([PASSED, PASSED]);
    await ctx.board.startCard(ctx.card.id);
    await cardWhen(ctx.board, ctx.card.id, (c) => c.column === "review");
    ctx.switchOn(ctx.card.id);
    await ctx.board.startCard(ctx.card.id);
    const checked = await poll(() => ctx.ran.length === 1, 10_000);
    expect(checked).toBe(true);
  });

  test("a discard waits for the killed check to end before the card goes", async () => {
    const ctx = await setup([FAILED]);
    ctx.switchOn(ctx.card.id);
    ctx.holdChecks();
    const exit = ctx.holdKill();
    await ctx.board.startCard(ctx.card.id);
    await poll(() => ctx.ran.length === 1, 10_000);
    let discarded = false;
    const discarding = ctx.board.discardCard(ctx.card.id, true).then(() => {
      discarded = true;
    });
    // The killed check has not exited yet: the discard must still be waiting for it.
    const early = await poll(() => discarded, 300);
    exit();
    await discarding;
    expect([early, ctx.finished]).toEqual([null, ["killed"]]);
  });

  test("completing the card waits for the killed check to end before its worktree goes", async () => {
    const ctx = await setup([FAILED]);
    ctx.switchOn(ctx.card.id);
    ctx.holdChecks();
    const exit = ctx.holdKill();
    await ctx.board.startCard(ctx.card.id);
    await poll(() => ctx.ran.length === 1, 10_000);
    let completed = false;
    const completing = ctx.board.completeCard(ctx.card.id, true).then(() => {
      completed = true;
    });
    const early = await poll(() => completed, 300);
    exit();
    await completing;
    expect([early, ctx.finished]).toEqual([null, ["killed"]]);
  });

  test("turning the switch on when the card's session cannot be read saves nothing: never a switch without its mark", async () => {
    const ctx = await setup();
    await ctx.board.startCard(ctx.card.id);
    await cardWhen(ctx.board, ctx.card.id, (c) => c.column === "review");
    const sessionId = ctx.board.getCard(ctx.card.id).sessionId as string;
    // Foreign keys keep a session a run points at; a store repaired by hand may not have it.
    ctx.store.db.run("PRAGMA foreign_keys = OFF");
    ctx.store.db.query("DELETE FROM sessions WHERE id = ?").run(sessionId);
    ctx.store.db.run("PRAGMA foreign_keys = ON");
    let thrown = "none";
    try {
      ctx.switchOn(ctx.card.id);
    } catch (error) {
      thrown = (error as { reason?: string }).reason ?? "error";
    }
    const row = ctx.store.db
      .query<{ loop_on: number; mark: number | null }, [string]>(
        "SELECT check_loop AS loop_on, check_loop_turn_seq AS mark FROM cards WHERE id = ?",
      )
      .get(ctx.card.id);
    expect([thrown, row?.loop_on, row?.mark]).toEqual(["session_not_found", 0, null]);
  });
});

describe("check-loop: the person's input over the protocol", () => {
  test("session.send and a persona switch on a card's session step its loop aside", async () => {
    const ctx = await setup();
    await ctx.board.startCard(ctx.card.id);
    await cardWhen(ctx.board, ctx.card.id, (c) => c.column === "review");
    const sessionId = ctx.board.getCard(ctx.card.id).sessionId as string;
    const stepped: string[] = [];
    ctx.board.personTurnOfSession = (id: string) => {
      stepped.push(id);
    };
    const token = "check-loop-board-token-0123456789ab";
    const server = startServer({
      manager: ctx.manager,
      board: ctx.board,
      personaSessions: { apply: async () => ({}), clear: async () => ({}) } as never,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token,
      allowedRoots: [ctx.root],
    });
    const client = new FrameClient(server.url);
    cleanups.push(async () => {
      client.close();
      await server.stop();
    });
    await client.request("hello", { token, client: "t" });
    ctx.manager.sessionOfRequest = () => sessionId;
    await client.request("session.send", { sessionId, text: "olha isso" });
    await client.request("session.applyPersona", { sessionId, persona: { id: "seg" } });
    await client.request("session.clearPersona", { sessionId });
    await client.request("session.interrupt", { sessionId });
    // An unknown request is refused after the lookup; the person's answer still counts first.
    await client.request("permission.respond", { requestId: "req-1", decision: "deny" });
    expect(stepped).toEqual([sessionId, sessionId, sessionId, sessionId, sessionId]);
  });
});

describe("check-loop: what the card says about its loop", () => {
  test("the card shows the loop checking, then the round it sent, then how it ended, and each step is a card update", async () => {
    const ctx = await setup([FAILED, PASSED]);
    ctx.switchOn(ctx.card.id);
    const seen: Array<string | null> = [];
    const sentBox: { last: { active: string | null; state: string | null } | null } = {
      last: null,
    };
    ctx.board.watch((card) => {
      if (card.id !== ctx.card.id) return;
      seen.push(card.checkLoop?.active ?? null);
      sentBox.last = {
        active: card.checkLoop?.active ?? null,
        state: card.checkLoop?.last?.state ?? null,
      };
    });
    const open = ctx.holdChecks();
    await ctx.board.startCard(ctx.card.id);
    await poll(() => ctx.ran.length === 1, 10_000);
    const checking = ctx.board.getCard(ctx.card.id).checkLoop;
    open();
    await poll(() => ctx.board.getCard(ctx.card.id).checkLoop?.active === "fixing", 10_000);
    const fixing = ctx.board.getCard(ctx.card.id).checkLoop;
    await cardWhen(ctx.board, ctx.card.id, (c) => c.column === "review");
    const ended = ctx.board.getCard(ctx.card.id).checkLoop;
    expect([
      checking?.active,
      [
        fixing?.active,
        fixing?.round,
        fixing?.max,
        fixing?.last?.state,
        fixing?.last?.command,
        fixing?.last?.exitCode,
      ],
      [ended?.active, ended?.last?.state, ended?.last?.reason],
      seen.includes("checking") && seen.includes("fixing"),
      // The last card the app was sent agrees with the end: not active any more.
      sentBox.last,
    ]).toEqual([
      "checking",
      ["fixing", 1, 3, "sent", "bun test", 1],
      [null, "ended", "passed"],
      true,
      { active: null, state: "ended" },
    ]);
  });

  test("an end with no placement (a stop) still sends a card that is no longer active", async () => {
    const ctx = await setup([FAILED]);
    ctx.switchOn(ctx.card.id);
    const sentBox: { last: { active: string | null; reason: string | null } | null } = {
      last: null,
    };
    ctx.board.watch((card) => {
      if (card.id !== ctx.card.id) return;
      sentBox.last = {
        active: card.checkLoop?.active ?? null,
        reason: card.checkLoop?.last?.reason ?? null,
      };
    });
    ctx.holdChecks();
    await ctx.board.startCard(ctx.card.id);
    await poll(() => ctx.ran.length === 1, 10_000);
    await ctx.board.stopCard(ctx.card.id);
    expect(sentBox.last).toEqual({ active: null, reason: "stopped_by_you" });
  });

  test("a session that ends while its checks run sends a last card that is no longer active", async () => {
    const ctx = await setup([FAILED]);
    ctx.switchOn(ctx.card.id);
    const sentBox: { last: { active: string | null; reason: string | null } | null } = {
      last: null,
    };
    ctx.board.watch((card) => {
      if (card.id !== ctx.card.id) return;
      sentBox.last = {
        active: card.checkLoop?.active ?? null,
        reason: card.checkLoop?.last?.reason ?? null,
      };
    });
    ctx.holdChecks();
    await ctx.board.startCard(ctx.card.id);
    await poll(() => ctx.ran.length === 1, 10_000);
    await ctx.manager.close(ctx.board.getCard(ctx.card.id).sessionId as string);
    await poll(() => sentBox.last?.reason === "session_ended", 5000);
    expect(sentBox.last).toEqual({ active: null, reason: "session_ended" });
  });

  test("a card with the switch off carries no loop line, so reading it asks the rounds table nothing", async () => {
    const ctx = await setup();
    expect(ctx.board.getCard(ctx.card.id).checkLoop).toEqual({
      on: false,
      rounds: null,
      confirmed: false,
    });
  });
});

describe("check-loop: input from any path", () => {
  test("a message reaching the card's session by any path while its checks run steps the loop aside", async () => {
    const ctx = await setup([PASSED]);
    ctx.switchOn(ctx.card.id);
    const open = ctx.holdChecks();
    await ctx.board.startCard(ctx.card.id);
    await poll(() => ctx.ran.length === 1, 10_000);
    const sessionId = ctx.board.getCard(ctx.card.id).sessionId as string;
    // As a review comment, a message between sessions or a persona hand-off write it.
    ctx.manager.send(sessionId, "um comentário de revisão");
    open();
    await cardWhen(ctx.board, ctx.card.id, (c) => c.column === "review");
    expect(ctx.rounds(ctx.card.id)[0]?.reason).toBe("person_turn");
  });
});

describe("check-loop: the person's input over the protocol, end to end", () => {
  test("session.send into a card whose checks run ends its loop as the person's turn", async () => {
    const ctx = await setup([PASSED]);
    ctx.switchOn(ctx.card.id);
    const open = ctx.holdChecks();
    await ctx.board.startCard(ctx.card.id);
    await poll(() => ctx.ran.length === 1, 10_000);
    const sessionId = ctx.board.getCard(ctx.card.id).sessionId as string;
    const token = "check-loop-board-token-0123456789cd";
    const server = startServer({
      manager: ctx.manager,
      board: ctx.board,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token,
      allowedRoots: [ctx.root],
    });
    const client = new FrameClient(server.url);
    cleanups.push(async () => {
      client.close();
      await server.stop();
    });
    await client.request("hello", { token, client: "t" });
    await client.request("session.send", { sessionId, text: "eu mesmo vejo" });
    open();
    await cardWhen(ctx.board, ctx.card.id, (c) => c.column === "review");
    expect(ctx.rounds(ctx.card.id)[0]?.reason).toBe("person_turn");
  });
});

describe("check-loop: the rounds table upgrade", () => {
  test("rounds stored by the table v0.37.18 shipped survive the change of its key, the summary as the reason", () => {
    const path = join(tempDir(), "events.db");
    const upgrade = MIGRATIONS.findIndex((sql) => sql.includes("card_check_rounds_card"));
    expect(upgrade).toBeGreaterThan(0);
    const old = new Database(path, { create: true });
    for (const sql of MIGRATIONS.slice(0, upgrade)) old.exec(sql);
    old.exec(`PRAGMA user_version = ${upgrade}`);
    old.exec(
      "INSERT INTO card_check_rounds (card_id, run_id, n, at, status, summary) VALUES ('c', 'r', 1, '2026-11-09', 'ended', 'passed')",
    );
    old.close();
    const store = new EventStore(path);
    cleanups.push(() => store.close());
    const rows = store.db
      .query<{ id: number; n: number; reason: string | null }, []>(
        "SELECT id, n, reason FROM card_check_rounds",
      )
      .all();
    expect(rows).toEqual([{ id: 1, n: 1, reason: "passed" }]);
  });
});

describe("check-loop: across a restart", () => {
  test("turning the switch on marks the session's last event, so a restart replays no old turn into checks", async () => {
    const ctx = await setup();
    await ctx.board.startCard(ctx.card.id);
    await cardWhen(ctx.board, ctx.card.id, (c) => c.column === "review");
    const sessionId = ctx.board.getCard(ctx.card.id).sessionId as string;
    ctx.switchOn(ctx.card.id);
    const mark = ctx.store.db
      .query<{ seq: number | null }, [string]>(
        "SELECT check_loop_turn_seq AS seq FROM cards WHERE id = ?",
      )
      .get(ctx.card.id)?.seq;
    const ranAfter: string[] = [];
    const again = new Board({
      db: ctx.store.db,
      manager: ctx.manager,
      allowedRoots: [ctx.root],
      checkLoop: {
        settings: () => ({
          checks: ["bun test"],
          checkTimeoutMin: 1,
          checkRounds: 3,
          checkEnv: [],
        }),
        isTrusted: () => true,
        runner: {
          run: async (command: string) => {
            ranAfter.push(command);
            return PASSED;
          },
        },
      },
    });
    cleanups.push(() => again.stop());
    // Its follow of the card's session must start nothing, from the replay or after it.
    const started = await poll(() => ranAfter.length > 0, 500);
    expect([mark, started, ranAfter]).toEqual([ctx.manager.get(sessionId).lastSeq, null, []]);
  });

  test("a round left open by a restart is closed as interrupted", async () => {
    const ctx = await setup();
    ctx.store.db
      .query(
        "INSERT INTO card_check_rounds (card_id, run_id, n, at, status) VALUES (?, 'r', 1, ?, 'sent')",
      )
      .run(ctx.card.id, new Date().toISOString());
    const again = new Board({
      db: ctx.store.db,
      manager: ctx.manager,
      allowedRoots: [ctx.root],
      checkLoop: {
        settings: () => ({}) as never,
        isTrusted: () => true,
        runner: { run: async () => PASSED },
      },
    });
    cleanups.push(() => again.stop());
    expect(ctx.rounds(ctx.card.id).map((row) => [row.status, row.reason])).toEqual([
      ["sent", null],
      ["ended", "interrupted"],
    ]);
  });
});
