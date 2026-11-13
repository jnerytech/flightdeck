import { afterEach, describe, expect, test } from "bun:test";
import { Automations } from "../../src/automations/automations.ts";
import { cleanups, fixture } from "../support/watch-helpers.ts";

afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** Issue #1609: one row whose JSON no longer fits its schema must not stop the others. */
describe("automations: a row that cannot be read is skipped, not fatal (#1609)", () => {
  test("the good automation still lists and fires; the bad one is logged by id", async () => {
    const f = await fixture();
    const logs: string[] = [];
    const automations = new Automations({
      db: f.store.db,
      board: f.board,
      issues: { list: async () => [], createCard: async () => f.card } as never,
      log: (message) => logs.push(message),
    });
    cleanups.push(() => automations.stop());
    const save = (name: string) =>
      automations.save({
        projectId: f.project.id,
        name,
        trigger: { type: "ci_failed" },
        action: { type: "send_to_card" },
      });
    const good = save("good");
    const bad = save("bad");
    automations.toggle(good.id, true, true);
    automations.toggle(bad.id, true, true);
    f.store.db
      .query("UPDATE automations SET trigger = ? WHERE id = ?")
      .run('{"type":"from-a-newer-daemon"}', bad.id);

    const listed = () => {
      try {
        return automations.list(f.project.id).map((a) => a.name);
      } catch (error) {
        return (error as Error).message;
      }
    };
    const fired = await automations
      .fire({ type: "ci_failed", cardId: f.card.id, key: "k1", summary: "CI" })
      .then(
        () => "fired",
        (error: Error) => error.message,
      );
    expect([
      fired,
      listed(),
      automations.runs(good.id).length,
      logs.some((line) => line.includes(bad.id) && !line.includes("from-a-newer-daemon")),
    ]).toEqual(["fired", ["good"], 1, true]);
  });
});
