import type { AppKernel } from "../../lib/kernel.ts";
import { hasFeature } from "../../lib/version.ts";
import { type ClientBudgetsCore, ClientBudgetsSlice } from "./client-budgets-store.ts";
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

/** The hosts as the clients' budgets read them: online ones that report costs. */
interface CostsHosts {
  hosts: readonly {
    id: string;
    status: string;
    hostInfo?: { features?: readonly string[] } | null;
  }[];
}

/**
 * Builds the clients' budgets slice from the store's kernel (#1596): each online host's
 * `costs.summary`, summed by client. The limits, the scope, the day, the webhook feed and the
 * inbox notice stay the store's, as deps.
 */
export function wireClientBudgets(
  kernel: AppKernel<ReturnType<ClientBudgetsCore["state"]> & CostsHosts>,
  deps: Omit<ClientBudgetsCore, "state" | "update" | "hostsWithCosts" | "summary" | "t">,
): ClientBudgetsSlice {
  return new ClientBudgetsSlice({
    ...deps,
    state: () => kernel.state(),
    update: (patch) => kernel.update(patch),
    hostsWithCosts: () =>
      kernel
        .state()
        .hosts.filter(
          (h) => h.status === "online" && hasFeature(h.hostInfo?.features, "costs", false),
        )
        .map((h) => h.id),
    summary: (hostId, filter) => kernel.hostCommand(hostId, "costs.summary", filter),
    t: () => kernel.t(),
  });
}
