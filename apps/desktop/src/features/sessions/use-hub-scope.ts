import { useEffect, useState, useSyncExternalStore } from "react";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import { ALL_SCOPE, activeScope, type DataScope } from "../costs/index.ts";
import { awayHost, scopeKeys } from "./domain/hub-scope.ts";

/** The project the route asked for, with the name the chip shows. */
export interface HubProject {
  hostId: string;
  projectKey: string;
  name: string;
}

/**
 * What the hub lists: the project and the host the route asked for, and the data scope the person
 * kept, resolved to one scope.
 */
export function useHubScope(
  store: AppStore,
  state: Pick<AppState, "hosts" | "hostsLoaded">,
  project: HubProject | undefined,
  host: string | undefined,
) {
  // The project the route asked for. Clearing it here sticks while the hub stays mounted (opening
  // a session changes the route but not the list); a different project from the route replaces it.
  const [only, setOnly] = useState(project ?? null);
  const askedKey = project ? `${project.hostId}/${project.projectKey}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a different project asked for by the route applies
  useEffect(() => {
    if (project) setOnly(project);
  }, [askedKey]);
  // The data scope (#126): the hub lists the sessions of its hosts. A host asked for by the route
  // ("See all" on its page, a name) wins for this visit and never rewrites the scope (#207); any
  // pick in the Data from menu ends the visit. Showing every host from a visit widens the visit.
  const kept = useSyncExternalStore(store.dataScope.subscribe, () => store.dataScope.value);
  const [visit, setVisit] = useState(host);
  const [visitAll, setVisitAll] = useState(false);
  useEffect(() => {
    if (host === undefined) return;
    setVisit(host);
    setVisitAll(false);
  }, [host]);
  useEffect(
    () =>
      store.dataScope.subscribe(() => {
        setVisit(undefined);
        setVisitAll(false);
      }),
    [store],
  );
  const visiting = visit === undefined ? undefined : state.hosts.find((h) => h.name === visit);
  let hostScope: DataScope = activeScope(kept, state.hosts, state.hostsLoaded);
  if (visitAll) hostScope = ALL_SCOPE;
  else if (visiting) hostScope = { kind: "host", hostId: visiting.id };
  // A project scope (#126 slice 4) shows that project's sessions, on every host it is on.
  const { host: scoped, project: scopedProject } = scopeKeys(hostScope);
  const away = awayHost(state.hosts, hostScope);
  return {
    only,
    /** Clears the project chip; it stays cleared while the hub stays mounted. */
    clearOnly: () => setOnly(null),
    hostScope,
    scoped,
    scopedProject,
    away,
    /** Widens the visit to every host; with no visit, the kept scope becomes every host. */
    showAllHosts: () => (visiting ? setVisitAll(true) : store.dataScope.set(ALL_SCOPE)),
  };
}
