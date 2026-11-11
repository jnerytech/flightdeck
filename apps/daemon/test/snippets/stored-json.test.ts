import { describe, expect, test } from "bun:test";
import { SecretScanner } from "../../src/snippets/model.ts";
import { Snippets } from "../../src/snippets/store.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { workspace } from "../support/helpers.ts";

/** #1609: the vars and tags of a stored snippet are read through a schema; a damaged column reads as empty. */
describe("snippets: damaged stored JSON", () => {
  test("a snippet whose vars or tags are damaged still lists, with no vars and no tags", async () => {
    const { root } = workspace();
    const store = new EventStore(":memory:");
    const snippets = new Snippets({
      db: store.db,
      allowedRoots: [root],
      scanner: new SecretScanner(),
      now: () => Date.parse("2026-11-11T12:00:00Z"),
    });
    const saved = await snippets.save({
      scope: "host",
      name: "status",
      type: "command",
      run: "git status",
      tags: ["git"],
    });
    const read = async (vars: string, tags: string) => {
      store.db
        .query("UPDATE snippets SET vars = ?, tags = ? WHERE id = ?")
        .run(vars, tags, saved.id);
      try {
        const got = await snippets.get(saved.id);
        return [got.vars, got.tags];
      } catch {
        return "threw";
      }
    };
    expect(await read("not json", "not json")).toEqual([{}, []]);
    expect(await read("[1]", '{"a":1}')).toEqual([{}, []]);
    expect(await read('{"x":{"default":5}}', "[1,2]")).toEqual([{}, []]);
  });
});
