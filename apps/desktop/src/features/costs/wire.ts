import type { AppKernel } from "../../lib/kernel.ts";
import { type BudgetsCore, BudgetsSlice } from "./store.ts";

/** Builds the budgets' slice from the store's kernel (#1596): a host's `budget.*` commands. */
export function wireBudgets(
  kernel: AppKernel<
    ReturnType<BudgetsCore["state"]> & { hosts: readonly { id: string; name: string }[] }
  >,
  deps: { feed: BudgetsCore["feed"]; notify: BudgetsCore["notify"] },
): BudgetsSlice {
  return new BudgetsSlice({
    state: () => kernel.state(),
    update: (patch) => kernel.update(patch),
    set: (hostId, input) => kernel.hostCommand(hostId, "budget.set", input),
    setQuota: (hostId, input) => kernel.hostCommand(hostId, "budget.setQuota", input),
    remove: (hostId, id) => kernel.hostCommand(hostId, "budget.remove", { id }),
    hostName: (hostId) => kernel.state().hosts.find((h) => h.id === hostId)?.name,
    feed: deps.feed,
    notify: deps.notify,
    t: () => kernel.t(),
  });
}
