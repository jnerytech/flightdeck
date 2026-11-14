import { describe, expect, test } from "bun:test";
import { DEFAULT_POLICY } from "../../src/messaging/domain/policy.ts";
import { Messaging } from "../../src/messaging/messages.ts";
import { PROJECT, setup } from "../support/messaging-helpers.ts";

/** #1609: the stored policy and a queued message's sender are read through schemas. */
describe("messaging: damaged stored JSON", () => {
  test("a stored policy that is not JSON starts the service with the default policy", () => {
    const { store, endpoints, names } = setup();
    store.db
      .query("INSERT OR REPLACE INTO messaging_config (id, policy) VALUES (1, ?)")
      .run("not json");
    const start = () =>
      new Messaging({ db: store.db, host: "pc", endpoints, names, teamOf: () => null });
    expect(start).not.toThrow();
    expect(start().getPolicy()).toEqual(DEFAULT_POLICY);
  });

  test("a queued message whose stored sender is damaged is left out of the outbox", () => {
    const { messaging, endpoints, store } = setup();
    endpoints.add("s1", { name: "arquiteta" });
    messaging.setPeers("wsl", [
      {
        id: "w1",
        name: "w1",
        persona: null,
        projectKey: PROJECT,
        teamId: null,
        state: "idle",
        kind: "managed",
        receives: true,
        reason: null,
      },
    ]);
    messaging.send({ as: { session: "s1" }, to: "wsl/w1", text: "hi" });
    expect(messaging.outbox()).toHaveLength(1);
    store.db.query("UPDATE session_messages SET sender = ?").run('{"id":5}');
    const read = () => {
      try {
        return messaging.outbox().length;
      } catch {
        return "threw";
      }
    };
    expect(read()).toBe(0);
    store.db.query("UPDATE session_messages SET sender = ?").run("not json");
    expect(read()).toBe(0);
  });
});
