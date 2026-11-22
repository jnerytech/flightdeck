import type { CostsFilter, CostsStatus, CostsSummary } from "@flightdeck/protocol";
import { useEffect, useState, useSyncExternalStore } from "react";
import { loadCostsSummary } from "@/features/clients/index.ts";
import { useKeyed } from "@/shared/hooks/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { routeScopeOf } from "./domain/costs-scope.ts";
import { ALL_SCOPE, activeScope, type DataScope } from "./domain/data-scope.ts";

/** The costs of `ids` for the selected client, from the hosts' own `costs.summary`. */
function askCosts(store: AppStore, ids: string[], filter: CostsFilter, selection: string) {
  return loadCostsSummary({
    hostIds: ids,
    filter,
    selection,
    scope: store.clientScope.get(),
    ask: (id, f) => store.hostCommand(id, "costs.summary", f),
  });
}

/**
 * What the screen asks for: the hosts, the period, the filters, the client and how the client's
 * projects are placed (a change to the clients asks again). Gives the period's summary, the same
 * period without filters (the filters offer its projects and models), which host each session came
 * from and the hosts that failed. An answer that arrives after the question changed is dropped.
 * `pending` is true while the question now asked has no answer yet, and `reload` asks it again.
 */
export function useCostsLoad(
  store: AppStore,
  ask: {
    hostIds: string[];
    filter: CostsFilter;
    days: { from: string; to: string };
    unfiltered: boolean;
    selection: string;
    placed: string;
  },
) {
  const { hostIds, filter, days, unfiltered, selection, placed } = ask;
  const [summary, setSummary] = useState<CostsSummary | null>(null);
  /** The period without filters: the filters offer every project and model of it. */
  const [all, setAll] = useState<CostsSummary | null>(null);
  const [sessionHost, setSessionHost] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string[]>([]);
  /** Each `reload` is a new round: the same question is asked again. */
  const [round, setRound] = useState(0);
  const keyed = useKeyed({ ids: hostIds, filter, selection, placed, round });
  /** The question the numbers on screen answer; `reload` clears it so the page reads as pending. */
  const [answered, setAnswered] = useState<typeof keyed | null>(null);
  useEffect(() => {
    const { ids, filter: asked } = keyed;
    if (ids.length === 0) {
      // No host to read (the scoped one is away): no numbers, not the last host's.
      setSummary(null);
      setAll(null);
      return;
    }
    let live = true;
    void askCosts(store, ids, asked, selection).then((loaded) => {
      if (!live) return;
      store.projectKeys.note(loaded.summary?.byProject.map((p) => p.projectKey) ?? []);
      setSummary(loaded.summary);
      if (Object.keys(asked).length === 2) setAll(loaded.summary);
      setSessionHost(loaded.sessionHost);
      setFailed(loaded.failed);
      setAnswered(keyed);
    });
    return () => {
      live = false;
    };
  }, [store, keyed, selection]);
  const daysKeyed = useKeyed({ ids: unfiltered ? [] : hostIds, days, selection, placed, round });
  useEffect(() => {
    const { ids, days: asked } = daysKeyed;
    if (ids.length === 0) return;
    let live = true;
    void askCosts(store, ids, asked, selection).then((loaded) => {
      if (!live) return;
      store.projectKeys.note(loaded.summary?.byProject.map((p) => p.projectKey) ?? []);
      setAll(loaded.summary);
    });
    return () => {
      live = false;
    };
  }, [store, daysKeyed, selection]);
  const pending = keyed.ids.length > 0 && answered !== keyed;
  const reload = () => {
    setAnswered(null);
    setRound((n) => n + 1);
  };
  return { summary, all, sessionHost, failed, pending, reload };
}

/** The cost status of the one host in view (price divergences and models without a price). */
export function useCostsStatus(store: AppStore, hostId: string, acrossHosts: boolean) {
  const [status, setStatus] = useState<CostsStatus | null>(null);
  useEffect(() => {
    if (hostId && !acrossHosts) void store.hostCommand(hostId, "costs.status", {}).then(setStatus);
    else setStatus(null);
  }, [store, hostId, acrossHosts]);
  return status;
}

/**
 * The data scope (#126) says whose costs these are: every host, one, or one project (slice 4). A
 * route's own host or project (an alert, a Home card) wins for this visit and never rewrites it;
 * choosing in the scope menu ends that choice.
 */
export function useCostsRoute(
  store: AppStore,
  state: { hosts: readonly { id: string }[]; hostsLoaded: boolean },
  route: { host?: string; projectKey?: string },
) {
  const keptScope = useSyncExternalStore(store.dataScope.subscribe, () => store.dataScope.value);
  const [routeHost, setRouteHost] = useState<string | null>(route.host ?? null);
  const [routeProject, setRouteProject] = useState<string | null>(route.projectKey ?? null);
  // Home opens Costs with `__all__` when several hosts have costs: every host, for this visit.
  const routeScope = routeScopeOf(routeHost);
  const kept = activeScope(keptScope, state.hosts, state.hostsLoaded);
  /** The project whose costs these are, if one: the route's, else the kept scope's. */
  const projectKey =
    routeProject ?? (routeScope === null && kept.kind === "project" ? kept.projectKey : null);
  // A project keeps every host; the route's host still narrows an alert to its host.
  const hostSide = routeScope ?? (kept.kind === "project" ? ALL_SCOPE : kept);
  const dataScope: DataScope = projectKey ? { kind: "project", projectKey } : hostSide;
  const endVisit = () => {
    setRouteHost(null);
    setRouteProject(null);
  };
  const showAllHosts = () => {
    endVisit();
    store.dataScope.set({ kind: "all" });
  };
  return { setRouteHost, setRouteProject, projectKey, hostSide, dataScope, endVisit, showAllHosts };
}
