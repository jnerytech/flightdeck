import type { Card, CostsSummary, Project } from "@flightdeck/protocol";
import { useEffect, useMemo, useState } from "react";
import { type HubRowState, hubRows } from "@/features/sessions/index.ts";
import type { AppKernel } from "../../lib/kernel.ts";
import { hasFeature } from "../../lib/version.ts";
import { addDays } from "../costs/index.ts";
import type { HostView } from "../hosts/index.ts";
import { buildProjectCards, type ProjectCard } from "./domain/project-cards.ts";

/** What the cards hook asks of the store: the palette's load, the day, the host command and a project's key. */
interface ProjectCardsStore extends Pick<AppKernel<object>, "hostCommand"> {
  palette: { load(): Promise<unknown> };
  today(): string;
  projectList: { keyOf(hostId: string, project: Project): string };
}

/** The part of the app's state the cards read: the hosts, their projects and cards. */
interface ProjectCardsState {
  projects: Record<string, Project[]>;
  cards: Record<string, Card>;
  hosts: HostView[];
}

/** One card per project of every online host, with the week's cost each host reports (issue #9). */
export function useProjectCards(
  store: ProjectCardsStore,
  state: ProjectCardsState & Omit<HubRowState, "hosts">,
): ProjectCard[] {
  return useProjectCardsRead(store, state).cards;
}

/**
 * The cards, and whether the hosts' project lists were read for the hosts as they are now: the
 * palette's load settled (an answer or a refusal) after the last change of a host's status, so a
 * screen can tell "not read yet" from "no projects" (#3922).
 */
export function useProjectCardsRead(
  store: ProjectCardsStore,
  state: ProjectCardsState & Omit<HubRowState, "hosts">,
): { cards: ProjectCard[]; read: boolean } {
  const [costs, setCosts] = useState<Record<string, CostsSummary | undefined>>({});
  const [settledFor, setSettledFor] = useState<string | null>(null);
  // The projects and their cards come from the palette's load; the week's cost from each host.
  const hostKey = state.hosts.map((h) => `${h.id}:${h.status}`).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the hosts' set or status changes
  useEffect(() => {
    // Only the newest load says the lists were read: an older one settling late must not undo it.
    let newest = true;
    void store.palette.load().finally(() => {
      if (newest) setSettledFor(hostKey);
    });
    const today = store.today();
    // A host that is not online keeps no figure: it is asked again when it comes back.
    const online = new Set(state.hosts.filter((h) => h.status === "online").map((h) => h.id));
    setCosts((all) => Object.fromEntries(Object.entries(all).filter(([id]) => online.has(id))));
    const filter = { from: addDays(today, -6), to: today };
    for (const host of state.hosts) {
      if (host.status !== "online" || !hasFeature(host.hostInfo?.features, "costs", false))
        continue;
      void store.hostCommand(host.id, "costs.summary", filter).then((summary) => {
        if (summary) setCosts((all) => ({ ...all, [host.id]: summary }));
      });
    }
    return () => {
      newest = false;
    };
  }, [store, hostKey]);
  const cards = useMemo(
    () =>
      buildProjectCards({
        hosts: state.hosts
          .filter((host) => host.status === "online")
          .map((host) => ({
            id: host.id,
            name: host.name,
            projects: state.projects[host.id] ?? [],
          })),
        keyOf: (hostId, project) => store.projectList.keyOf(hostId, project),
        rows: hubRows(state),
        cards: Object.entries(state.cards).map(([key, card]) => ({
          hostId: state.hosts.find((h) => key.startsWith(`${h.id}/`))?.id ?? "",
          card,
        })),
        costs,
      }),
    [state, store, costs],
  );
  return { cards, read: settledFor === hostKey };
}
