import type { AppKernel } from "../../lib/kernel.ts";
import { type VaultApprovalsCore, VaultApprovalsSlice } from "./approvals-store.ts";
import { type VaultRulesCore, VaultRulesSlice } from "./rules-store.ts";
import { type VaultSecretsCore, VaultSecretsSlice } from "./secrets-store.ts";
import type { SecretMeta } from "./vault.ts";

/** The app's state as the vault's slices read it. */
interface VaultState {
  hosts: readonly { id: string; name: string; url: string }[];
  secrets: SecretMeta[];
  vaultApprovals: ReturnType<VaultApprovalsCore["pending"]>;
}

/**
 * Builds the queue of a host's vault requests from the store's kernel (#1596): the answer goes
 * back on the host's connection. The vault, its policy, the notice and the usage log stay the
 * store's, as deps.
 */
export function wireVaultApprovals(
  kernel: AppKernel<VaultState>,
  deps: Pick<VaultApprovalsCore, "vault" | "optionsPolicy" | "notify" | "recorded">,
): VaultApprovalsSlice {
  return new VaultApprovalsSlice({
    vault: deps.vault,
    pending: () => kernel.state().vaultApprovals,
    setPending: (items) => kernel.update({ vaultApprovals: items }),
    hostName: (hostId) => kernel.state().hosts.find((h) => h.id === hostId)?.name ?? null,
    hostUrl: (hostId) => kernel.state().hosts.find((h) => h.id === hostId)?.url ?? "",
    dispatch: (hostId, type, payload) => kernel.dispatch(hostId, type, payload),
    optionsPolicy: deps.optionsPolicy,
    now: () => kernel.now(),
    notify: deps.notify,
    recorded: deps.recorded,
    t: () => kernel.t(),
  });
}

/** Builds the secrets' slice (#1596): the list in the app's state follows the vault's. */
export function wireVaultSecrets(
  kernel: AppKernel<VaultState>,
  deps: Omit<VaultSecretsCore, "secretsChanged">,
): VaultSecretsSlice {
  return new VaultSecretsSlice({
    ...deps,
    secretsChanged: () => kernel.update({ secrets: deps.vault.list() }),
  });
}

/**
 * Builds the vault rules' slice from the store's kernel (#1596): a host's `vault.rules.*`
 * commands. The rules' storage, the clients and the toasts stay the store's, as deps.
 */
export function wireVaultRules(
  kernel: AppKernel<VaultState & { hosts: ReturnType<VaultRulesCore["hosts"]> }>,
  deps: Omit<VaultRulesCore, "hosts" | "secretsChanged" | "request" | "preview" | "t">,
): VaultRulesSlice {
  return new VaultRulesSlice({
    ...deps,
    secretsChanged: () => kernel.update({ secrets: deps.secrets() }),
    hosts: () => kernel.state().hosts,
    request: (hostId, type, payload) => kernel.hostRequest(hostId, type, payload),
    preview: (hostId, payload) => kernel.hostCommand(hostId, "vault.rules.preview", payload),
    t: () => kernel.t(),
  });
}
