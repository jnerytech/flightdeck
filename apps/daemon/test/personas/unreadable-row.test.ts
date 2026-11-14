import { describe, expect, test } from "bun:test";
import { PACK_IDS, packPersonas } from "../../src/personas/pack.ts";
import { Personas } from "../../src/personas/store.ts";
import { SecretScanner } from "../../src/snippets/domain/model.ts";
import { EventStore } from "../../src/store/event-store.ts";

/** Issue #1609: one persona row whose JSON no longer fits must not hide the others. */
describe("personas: a host row that cannot be read is skipped and logged (#1609)", () => {
  test("the good persona still lists; the bad one is logged by id, never by content", async () => {
    const db = new EventStore(":memory:").db;
    const logs: string[] = [];
    const personas = new Personas({
      db,
      allowedRoots: [],
      scanner: new SecretScanner(),
      log: (message) => logs.push(message),
    });
    await personas.save({
      scope: "host",
      persona: { id: "good", name: "Good", description: "fine", body: "Do well." },
    });
    await personas.save({
      scope: "host",
      persona: { id: "bad", name: "Bad", description: "will break", body: "Do badly." },
    });
    db.query("UPDATE personas SET data = ? WHERE id = 'bad'").run(
      '{"id":"bad","secret":"hunter2"}',
    );

    const listed = await personas.list({ scope: "host" }).then(
      (all) => all.personas.map((p) => p.id),
      (error: Error) => error.message,
    );
    expect([
      listed,
      logs.some(
        (line) => line.startsWith("personas: bad is unreadable") && !line.includes("hunter2"),
      ),
    ]).toEqual([["good"], true]);
  });

  test("an edit of a pack persona that cannot be read does not bring the wider pack one back", async () => {
    const db = new EventStore(":memory:").db;
    const personas = new Personas({
      db,
      allowedRoots: [],
      scanner: new SecretScanner(),
      pack: packPersonas,
    });
    const id = PACK_IDS[0] as string;
    await personas.save({
      scope: "host",
      persona: { id, name: "Stricter", description: "edited", body: "Read only.", tools: ["Read"] },
    });
    db.query("UPDATE personas SET data = ? WHERE id = ?").run('{"id":"x"}', id);

    const ids = await personas.list({ scope: "host", language: "en" }).then(
      (all) => all.personas.map((p) => p.id),
      (error: Error) => error.message,
    );
    expect(Array.isArray(ids) && ids.includes(id)).toBe(false);
  });

  test("a row whose data names another id than its own is not listed under that id", async () => {
    const db = new EventStore(":memory:").db;
    const personas = new Personas({ db, allowedRoots: [], scanner: new SecretScanner() });
    await personas.save({
      scope: "host",
      persona: { id: "mine", name: "Mine", description: "d", body: "Do." },
    });
    const data = (
      db.query("SELECT data FROM personas WHERE id = 'mine'").get() as { data: string }
    ).data.replace('"id":"mine"', '"id":"other"');
    db.query("UPDATE personas SET data = ? WHERE id = 'mine'").run(data);

    const ids = await personas.list({ scope: "host" }).then((all) => all.personas.map((p) => p.id));
    expect(ids).toEqual([]);
  });
});
