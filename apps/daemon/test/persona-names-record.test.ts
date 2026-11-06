import { afterEach, describe, expect, test } from "bun:test";
import { Names } from "../src/names/names.ts";
import { EventStore } from "../src/store/event-store.ts";

const cleanups: Array<() => unknown> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

/** Issue #101: a session's name record says whether it is the standard name, and its team. */
describe("persona-names: a name says whether it is the standard one (#101)", () => {
  test("standard until renamed in Flightdeck or titled in Claude Code; a team set on an unnamed session waits", () => {
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    const names = new Names(store.db);
    names.assign("a", { project: "app" });
    names.assign("b", { project: "app" });
    names.assign("c", { project: "app" });
    names.rename("b", "minha sessão");
    names.adoptTitle("c", "fd-coordinator", "custom");
    names.setTeam("a", { name: "md-server", role: "worker", number: 3 });
    expect(() => names.setTeam("nobody", { name: "x", role: "worker", number: 1 })).not.toThrow();
    names.assign("nobody", {
      project: "app",
      team: { name: "md-server", role: "coordinator", number: null },
    });
    expect([
      ["a", "b", "c"].map((id) => names.get(id)?.standard),
      names.get("a")?.team,
      names.get("a")?.aliases,
      names.get("b")?.team ?? "no team",
      names.get("nobody")?.team,
    ]).toEqual([
      [true, false, false],
      { name: "md-server", role: "worker", number: 3 },
      ["app-geral-1"],
      "no team",
      { name: "md-server", role: "coordinator", number: null },
    ]);
  });
});
