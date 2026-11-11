import type { AppKernel } from "../../lib/kernel.ts";
import { type ClientScopeCore, ClientScopeSlice, type ClientScopeState } from "./scope-store.ts";

/**
 * Builds the client scope's slice from the store's kernel (#1596): its state and update. The
 * storage, the kept clients, the known projects and what looks again on a change stay named deps.
 */
export function wireClientScope(
  kernel: AppKernel<ClientScopeState>,
  deps: Pick<ClientScopeCore, "storage" | "clients" | "projects" | "changed">,
): ClientScopeSlice {
  return new ClientScopeSlice({
    state: () => kernel.state(),
    update: (patch) => kernel.update(patch),
    ...deps,
  });
}
