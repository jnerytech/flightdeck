import { describe, expect, test } from "bun:test";
import { Actions } from "../../src/actions/actions.ts";
import { createVault } from "../../src/actions/wiring.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { Vault } from "../../src/vault/index.ts";

/** The module hands the server the host's vault and the actions that use it. */
describe("vault-wiring: the module the server takes `vault` and `actions` from", () => {
  test("it supplies the vault and the actions it built, under their keys", () => {
    const store = new EventStore(":memory:");
    const built = createVault({
      db: store.db,
      log: () => {},
      runtimeKind: "fake",
      actions: {
        projects: () => {
          throw new Error("no project");
        },
        hostName: "host",
        risk: () => "low",
        projectKey: () => undefined,
      },
    });
    const server = built.modules[0].server;
    expect([
      server?.vault instanceof Vault,
      server?.vault === built.vault,
      server?.actions instanceof Actions,
      server?.actions === built.actions,
    ]).toEqual([true, true, true, true]);
    store.close();
  });

  test("a fresh vault holds nothing, so the file log has nothing to redact yet", () => {
    const store = new EventStore(":memory:");
    const { vault } = createVault({
      db: store.db,
      log: () => {},
      runtimeKind: "fake",
      actions: {
        projects: () => {
          throw new Error("no project");
        },
        hostName: "host",
        risk: () => "low",
        projectKey: () => undefined,
      },
    });
    expect(vault.heldValues()).toEqual([]);
    store.close();
  });
});
