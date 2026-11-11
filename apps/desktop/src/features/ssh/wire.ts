import type { AppKernel } from "../../lib/kernel.ts";
import { type SshCore, SshSlice } from "./store.ts";

/**
 * Builds the ssh's slice from the store's kernel (#1596): a host's `ssh.*` commands and the
 * askpass answer. Which secrets the vault keeps and what it delivers stay the vault's, as deps.
 */
export function wireSsh(
  kernel: AppKernel<ReturnType<SshCore["state"]>>,
  deps: { hasSecret: SshCore["hasSecret"]; secretFor: SshCore["secretFor"] },
): SshSlice {
  return new SshSlice({
    state: () => kernel.state(),
    update: (patch) => kernel.update(patch),
    list: (hostId) => kernel.hostCommand(hostId, "ssh.list", {}),
    peek: (hostId) => kernel.dispatch(hostId, "ssh.list", {}).catch(() => null),
    save: (hostId, payload) => kernel.hostCommand(hostId, "ssh.save", payload),
    connect: (hostId, payload) => kernel.hostCommand(hostId, "ssh.connect", payload),
    answer: (hostId, requestId, secret) =>
      kernel.hostCommand(hostId, "askpass.answer", { requestId, secret }),
    hasSecret: deps.hasSecret,
    secretFor: deps.secretFor,
  });
}
