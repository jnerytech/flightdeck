import type { CostsSummary } from "@flightdeck/protocol";
import { useEffect, useMemo, useState } from "react";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { addDays, localDay } from "../lib/costs.ts";
import { type HubRowState, hubRows } from "../lib/hub.ts";
import { buildProjectCards, type ProjectCard } from "../lib/project-cards.ts";
import { hasFeature } from "../lib/version.ts";

/** One card per project of every online host, with the week's cost each host reports (issue #9). */
export function useProjectCards(
  store: AppStore,
  state: Pick<AppState, "projects" | "cards"> & HubRowState,
): ProjectCard[] {
  const [costs, setCosts] = useState<Record<string, CostsSummary | undefined>>({});
  // The projects and their cards come from the palette's load; the week's cost from each host.
  const hostKey = state.hosts.map((h) => `${h.id}:${h.status}`).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the hosts' set or status changes
  useEffect(() => {
    void store.loadPalette();
    const today = localDay(Date.now());
    const filter = { from: addDays(today, -6), to: today };
    for (const host of state.hosts) {
      if (host.status !== "online" || !hasFeature(host.hostInfo?.features, "costs", false))
        continue;
      void store.hostCommand(host.id, "costs.summary", filter).then((summary) => {
        if (summary) setCosts((all) => ({ ...all, [host.id]: summary }));
      });
    }
  }, [store, hostKey]);
  return useMemo(
    () =>
      buildProjectCards({
        hosts: state.hosts
          .filter((host) => host.status === "online")
          .map((host) => ({
            id: host.id,
            name: host.name,
            projects: state.projects[host.id] ?? [],
          })),
        keyOf: (hostId, project) => store.projectKeyOf(hostId, project),
        rows: hubRows(state),
        cards: Object.entries(state.cards).map(([key, card]) => ({
          hostId: state.hosts.find((h) => key.startsWith(`${h.id}/`))?.id ?? "",
          card,
        })),
        costs,
      }),
    [state, store, costs],
  );
}
