import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { Actions, type ActionsOptions } from "../actions/index.ts";
import type { RuntimeKind } from "../config.ts";
import { VaultRules } from "./rules-store.ts";
import { Vault } from "./vault.ts";

/**
 * What a delivered secret can be used for. In this phase only the fake runtime has an action, the
 * smoke's `echo`, which answers the value's SHA-256 and never the value: no real daemon has a way
 * to read a secret back out.
 */
export function vaultActions(kind: RuntimeKind): Record<string, (value: string) => string> {
  return kind === "fake"
    ? { echo: (value) => createHash("sha256").update(value).digest("hex") }
    : {};
}

/** What the host's vault and its actions are built from. */
export interface VaultDeps {
  db: Database;
  log: (message: string) => void;
  /** The runtime the daemon runs: only the fake one has an action of the vault's own. */
  runtimeKind: RuntimeKind;
  /** What an action reaches: the projects, the SSH destinations, the risk and the project keys. */
  actions: Pick<
    ActionsOptions,
    "projects" | "ssh" | "sshTags" | "sshKey" | "hostName" | "risk" | "projectKey"
  >;
}

/**
 * The host's secrets (phases 16, 17 and 19, issue #1593): the vault, which holds what the app
 * hands over for one use, and the actions that use a secret without Claude seeing it, under the
 * rules the app hands over.
 */
export function createVault({ db, log, runtimeKind, actions }: VaultDeps) {
  // Phase 16: secrets the app hands over for one use; in memory only, gone with the daemon.
  const vault = new Vault({
    log,
    actions: vaultActions(runtimeKind),
  });
  return {
    vault,
    // Phase 17: the actions that use a secret from the vault without Claude seeing it.
    actions: new Actions({
      db,
      vault,
      ...actions,
      // Phase 19: who may use which secret, decided by the rules the app hands over.
      rules: new VaultRules(),
    }),
  };
}
