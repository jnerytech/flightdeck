import { describe, expect, test } from "bun:test";
import { Personas } from "../../src/personas/store.ts";
import { SecretScanner } from "../../src/snippets/model.ts";
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
      logs.some((line) => line.includes("bad") && !line.includes("hunter2")),
    ]).toEqual([["good"], true]);
  });
});
