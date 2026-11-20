import type { AppKernel } from "../../lib/kernel.ts";
import type { Platform } from "../../platform/types.ts";
import { type ApprovalCore, ApprovalSlice } from "./store.ts";

/**
 * Builds the approval devices' slice from the store's kernel (#3439): the host's announcement comes
 * from its view in the state, the requests go on the host's connection. The key store (the shell's),
 * the language and the translator stay the store's, as deps.
 */
export function wireApproval(
  kernel: AppKernel<{
    hosts: Array<{
      id: string;
      name: string;
      hostInfo: { features?: string[]; daemonId?: string } | null;
    }>;
  }>,
  deps: { platform: Pick<Platform, "approvalKeys">; lang: () => string },
): ApprovalSlice {
  return new ApprovalSlice({
    keys: () => deps.platform.approvalKeys,
    host: (hostId) => {
      const host = kernel.state().hosts.find((h) => h.id === hostId);
      const info = host?.hostInfo;
      return info
        ? { features: info.features, daemonId: info.daemonId, name: host.name }
        : undefined;
    },
    success: (text) => kernel.success(text),
    fail: (text) => kernel.fail(new Error(text), text),
    request: (hostId, type, payload) => kernel.hostRequest(hostId, type, payload),
    lang: deps.lang,
    t: () => kernel.t(),
  } satisfies ApprovalCore);
}
