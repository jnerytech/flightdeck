import type { AppKernel } from "../../lib/kernel.ts";
import { type PermissionsCore, PermissionsSlice } from "./store.ts";

/**
 * Builds the permissions slice from the store's kernel (#1596): the open sessions and the selected
 * host come from the state, the answer goes out on the host's connection, refusals to the banner.
 * The "needs you" queue, the vault's own approvals and the open session's channel stay the
 * store's, as deps.
 */
export function wirePermissions(
  kernel: AppKernel<{
    sessions: ReturnType<PermissionsCore["sessions"]>;
    selected: { hostId: string } | null;
  }>,
  deps: Pick<PermissionsCore, "needsYou" | "settleVault" | "sendSelected">,
): PermissionsSlice {
  return new PermissionsSlice({
    needsYou: deps.needsYou,
    sessions: () => kernel.state().sessions,
    selectedHostId: () => kernel.state().selected?.hostId,
    settleVault: deps.settleVault,
    sendOn: (hostId, response) =>
      kernel.connection(hostId)?.request("permission.respond", response),
    sendSelected: deps.sendSelected,
    fail: (error, text) => kernel.fail(error, text),
    t: () => kernel.t(),
  });
}
