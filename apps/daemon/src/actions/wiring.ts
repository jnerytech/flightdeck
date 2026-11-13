import type { Database } from "bun:sqlite";
import type { RuntimeKind } from "../config.ts";
import type { DomainModule } from "../server/index.ts";
import { Vault, VaultRules, vaultActions } from "../vault/index.ts";
import { Actions, type ActionsOptions } from "./actions.ts";

/** What the host's vault and its actions are built from. */
export interface VaultDeps {
  db: Database;
  log: (message: string) => void;
  /** The runtime the daemon runs: only the fake one has an action of the vault's own. */
  runtimeKind: RuntimeKind;
  /** What an action reaches: the projects, the SSH destinations, the risk and the project keys. */
  actions: Omit<ActionsOptions, "db" | "vault" | "rules">;
}

/**
 * The host's secrets (phases 16, 17 and 19, issue #1593): the vault, which holds what the app
 * hands over for one use, and the actions that use a secret without Claude seeing it, under the
 * rules the app hands over. Its module hands the server both as `vault` and `actions`; `main.ts`
 * stops them itself, in its place among the domains still wired by hand.
 */
export function createVault({ db, log, runtimeKind, actions }: VaultDeps) {
  // Phase 16: secrets the app hands over for one use; in memory only, gone with the daemon.
  const vault = new Vault({
    log,
    actions: vaultActions(runtimeKind),
  });
  // Phase 17: the actions that use a secret from the vault without Claude seeing it.
  const host = new Actions({
    db,
    vault,
    ...actions,
    // Phase 19: who may use which secret, decided by the rules the app hands over.
    rules: new VaultRules(),
  });
  const module: DomainModule<"vault" | "actions"> = { server: { vault, actions: host } };
  return { modules: [module] as const, vault, actions: host };
}
