import { describe, expect, test } from "bun:test";
import { createNames } from "../../src/names/wiring.ts";
import { EventStore } from "../../src/store/event-store.ts";

/** Phase 21: the module hands the server the names kept on this host's store. */
describe("names-wiring: the module the server takes `names` from", () => {
  test("the server and the sessions read one set of names, kept on the host's store", () => {
    const { db } = new EventStore(":memory:");
    const built = createNames(db);
    const assigned = built.names.assign("s1", { project: "app", persona: "dev" });
    expect(built.modules[0].server?.names).toBe(built.names);
    expect(built.modules[0].server?.names?.get("s1")?.display).toBe(assigned.display);
  });
});
