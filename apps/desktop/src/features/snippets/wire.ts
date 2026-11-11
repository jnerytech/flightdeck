import type { AppKernel } from "../../lib/kernel.ts";
import type { Platform } from "../../platform/types.ts";
import { type SnippetsCore, SnippetsSlice } from "./store.ts";

/** Builds the snippets' slice from the store's kernel (#1596): a host's snippets, one, or one rendered. */
export function wireSnippets(
  kernel: AppKernel<ReturnType<SnippetsCore["state"]>>,
  deps: { storage: Platform["storage"] },
): SnippetsSlice {
  return new SnippetsSlice({
    state: () => kernel.state(),
    update: (patch) => kernel.update(patch),
    storage: deps.storage,
    list: (hostId, type) => kernel.hostCommand(hostId, "snippets.list", { type }),
    get: (hostId, id) => kernel.hostCommand(hostId, "snippets.get", { id }),
    render: (hostId, id, cwd) =>
      kernel.hostRequest(hostId, "snippets.render", { id, context: { cwd } }),
  });
}
