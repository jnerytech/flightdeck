import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { PrProvider } from "../../src/pr/index.ts";
import { readWatchSettings } from "../../src/watch/settings.ts";
import { PrWatcher, type WatchTrigger } from "../../src/watch/watch.ts";
import { cleanups, comment, fixture } from "../support/watch-helpers.ts";

setDefaultTimeout(30_000);
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * #1609: what the watch keeps as JSON (a project's settings, a card's snapshot, a round's trigger
 * and drift) is read through a schema. A row an older daemon or a hand edit damaged reads as
 * "nothing stored", never as a throw that stops every card's watch or a shape the code trusts.
 */
describe("watch: damaged stored JSON", () => {
  test("a project's settings that are not JSON read as the defaults", async () => {
    const f = await fixture();
    f.store.db
      .query("INSERT OR REPLACE INTO pr_watch_project (project_id, settings) VALUES (?, ?)")
      .run(f.project.id, "{not json");
    const read = () => readWatchSettings(f.store.db, f.project.id);
    expect(read).not.toThrow();
    expect(read().maxRounds).toBe(3);
    expect(read().enabled).toBe(false);
  });

  test("settings that are an array, not an object, read as the defaults", async () => {
    const f = await fixture();
    f.store.db
      .query("INSERT OR REPLACE INTO pr_watch_project (project_id, settings) VALUES (?, ?)")
      .run(f.project.id, "[1,2]");
    expect(Object.keys(readWatchSettings(f.store.db, f.project.id))).not.toContain("0");
  });

  test("a round whose trigger is damaged reads as an empty trigger, and a damaged drift as none", async () => {
    const f = await fixture();
    f.store.db
      .query(
        `INSERT INTO pr_watch_rounds (id, card_id, n, status, trigger, drift, started_at)
         VALUES ('r1', ?, 1, 'held', 'not json', '{"outside":"x"}', 't')`,
      )
      .run(f.card.id);
    const rounds = () => f.fixer.rounds(f.card.id);
    expect(rounds).not.toThrow();
    expect(rounds()[0]?.trigger).toEqual({ failed: [], conflicts: false, comments: [] });
    expect(rounds()[0]?.drift).toBeNull();
  });

  test("a card whose snapshot is damaged is looked at as a first look: its news still fires", async () => {
    const f = await fixture();
    const provider: PrProvider = {
      create: async () => "",
      url: async () => null,
      status: async () => ({ state: "open", checks: null }),
      comments: async () => [comment("1", "troque o nome")],
      health: async () => ({ checks: [], conflicts: false }),
      buildLog: async () => "",
    };
    const triggers: WatchTrigger[] = [];
    const watcher = new PrWatcher({
      db: f.store.db,
      board: f.board,
      provider: () => provider,
      onTrigger: (t) => {
        triggers.push(t);
      },
    });
    watcher.setEnabled(f.card.id, true);
    f.store.db.query("UPDATE pr_watch SET snapshot = ? WHERE card_id = ?").run("{nope", f.card.id);
    await watcher.tick();
    expect(triggers.map((t) => t.comments.length)).toEqual([1]);
  });
});
