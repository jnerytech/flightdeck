import { Database } from "bun:sqlite";
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { Board } from "../../src/board/board.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { MIGRATIONS } from "../../src/store/migrations.ts";
import { readWatchSettings } from "../../src/watch/settings.ts";
import { PrWatcher } from "../../src/watch/watch.ts";
import { cardWhen } from "../support/board-helpers.ts";
import { poll, tempDir } from "../support/helpers.ts";
import { cleanups, PASSED, setup, teardown } from "./check-loop-board-setup.ts";

// Real git (a worktree per card): more than the default 5 s.
setDefaultTimeout(30_000);
afterEach(teardown);

describe("check-loop: the board starting with a looping card", () => {
  test("a board whose watch settings are not readable yet still starts and reads a looping card", async () => {
    const ctx = await setup([PASSED]);
    ctx.switchOn(ctx.card.id);
    await ctx.board.startCard(ctx.card.id);
    await cardWhen(ctx.board, ctx.card.id, (c) => c.column === "review");
    let started = "yes";
    let again: Board | null = null;
    try {
      again = new Board({
        db: ctx.store.db,
        manager: ctx.manager,
        allowedRoots: [ctx.root],
        checkLoop: {
          // As main.ts's watcher before it is made: reading it throws.
          settings: () => {
            throw new ReferenceError("prWatcher is not initialized");
          },
          isTrusted: () => true,
          runner: { run: async () => PASSED },
        },
      });
      started = again.getCard(ctx.card.id).checkLoop?.on ? "yes" : "no switch";
    } catch (error) {
      started = (error as Error).message;
    } finally {
      again?.stop();
    }
    expect(started).toBe("yes");
  });

  test("a stored rounds cap out of 1 to 10 is read back inside it", async () => {
    const ctx = await setup();
    const store = (value: number) =>
      ctx.store.db
        .query(
          `INSERT INTO pr_watch_project (project_id, settings) VALUES (?, ?)
           ON CONFLICT (project_id) DO UPDATE SET settings = excluded.settings`,
        )
        .run(ctx.project.id, JSON.stringify({ checkRounds: value }));
    store(0);
    const low = readWatchSettings(ctx.store.db, ctx.project.id).checkRounds;
    store(50);
    const high = readWatchSettings(ctx.store.db, ctx.project.id).checkRounds;
    expect([low, high]).toEqual([1, 10]);
  });

  test("settings that cannot be read leave the card without its cap, and say so once in the log", async () => {
    const lines: string[] = [];
    const ctx = await setup();
    ctx.switchOn(ctx.card.id);
    const again = new Board({
      db: ctx.store.db,
      manager: ctx.manager,
      allowedRoots: [ctx.root],
      log: (line: string) => lines.push(line),
      checkLoop: {
        settings: () => {
          throw new SyntaxError("Unexpected token in JSON");
        },
        isTrusted: () => true,
        runner: { run: async () => PASSED },
      },
    });
    cleanups.push(() => again.stop());
    const first = again.getCard(ctx.card.id).checkLoop?.max;
    again.getCard(ctx.card.id);
    expect([first, lines.filter((line) => line.includes("check loop")).length]).toEqual([
      undefined,
      1,
    ]);
  });

  test("the watch settings can be read from the database alone, as the watcher reads them", async () => {
    const ctx = await setup();
    const watcher = new PrWatcher({ db: ctx.store.db, board: ctx.board });
    watcher.setSettings(ctx.project.id, { checkRounds: 4 });
    expect(readWatchSettings(ctx.store.db, ctx.project.id)).toEqual(
      watcher.settings(ctx.project.id),
    );
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
    // The mark itself: a turn at or below it, even delivered live, starts nothing; one past it does
    // (the control that shows the feed can start checks at all).
    const turn = { type: "turn.result", subtype: "success", isError: false, durationMs: 1 };
    const feed = (seq: number) =>
      (
        again as unknown as {
          onSessionEvent(id: string, event: object, at: { live: boolean; seq: number }): void;
        }
      ).onSessionEvent(ctx.card.id, turn, { live: true, seq });
    feed(mark ?? 0);
    expect(await poll(() => ranAfter.length > 0, 500)).toBeNull();
    feed((mark ?? 0) + 1);
    expect(await poll(() => ranAfter.length > 0, 5000)).not.toBeNull();
    expect(ranAfter).toEqual(["bun test"]);
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
