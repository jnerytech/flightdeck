import type { Card, Project } from "@flightdeck/protocol";
import { useCallback, useRef, useState } from "react";
import type { T } from "../../i18n/index.ts";
import type { AppKernel } from "../../lib/kernel.ts";
import { cardStartBlock } from "../board/index.ts";
import type { HostView } from "../hosts/index.ts";
import {
  type Elsewhere,
  type ElsewhereAsk,
  type ElsewhereOutcome,
  type HostFacts,
  offeredHosts,
  startElsewhere,
} from "./domain/start-elsewhere.ts";

/** What the hook asks of the store: the host commands, the live hosts, a project's key and a board's load. */
interface ElsewhereStore extends Pick<AppKernel<object>, "hostCommand" | "hostRequest"> {
  getState(): { hosts: HostView[] };
  projectList: { keyOf(hostId: string, project: Project): string };
  boardCards: { load(hostId: string, projectId: string): Promise<void> };
}

/** What another host said when the Start N confirm opened: its projects and its limit. */
interface Listed {
  projects: Array<{ id: string; key: string }>;
  limit: number;
}

/**
 * #1422: the other hosts a Start that would wait can go to. `load` asks each online host for its
 * projects and its limit when the confirm opens (and its board for the project of the same
 * repository, so the running cards are counted); `offers` is the list for the cards that would
 * wait; `run` hands them to one host. A reply to an earlier `load` is dropped.
 */
export function useStartElsewhere(options: {
  store: ElsewhereStore;
  hostId: string;
  /** The project's key; null while it is not known. */
  sourceKey: string | null;
  hosts: HostView[];
  cards: Record<string, Card>;
  t: T;
}): {
  load(): void;
  offers(waiting: Card[]): Elsewhere[];
  run(target: Elsewhere, cards: Card[]): Promise<ElsewhereOutcome>;
} {
  const { store, hostId, sourceKey, hosts, cards, t } = options;
  const [listed, setListed] = useState<Record<string, Listed>>({});
  const asked = useRef(0);
  const load = useCallback(() => {
    const mine = ++asked.current;
    setListed({});
    if (sourceKey === null) return;
    for (const host of store.getState().hosts) {
      if (host.id === hostId || host.status !== "online") continue;
      void store.hostCommand(host.id, "project.list", {}).then(async (list) => {
        if (mine !== asked.current || !list) return;
        const projects = list.projects.map((p) => ({
          id: p.id,
          key: store.projectList.keyOf(host.id, p),
        }));
        // The limit is the host's, so the cards running in all its projects count against it.
        if (projects.some((p) => p.key === sourceKey)) {
          await Promise.all(projects.map((p) => store.boardCards.load(host.id, p.id)));
        }
        if (mine !== asked.current) return;
        setListed((before) => ({
          ...before,
          [host.id]: { projects, limit: list.maxParallelRuns },
        }));
      });
    }
  }, [store, hostId, sourceKey]);
  const offers = (waiting: Card[]): Elsewhere[] => {
    const facts: HostFacts[] = hosts.flatMap((host) => {
      const said = listed[host.id];
      if (!said) return [];
      const running = Object.entries(cards).filter(
        ([key, card]) => key.startsWith(`${host.id}/`) && cardStartBlock(card) === "running",
      ).length;
      return [
        {
          id: host.id,
          name: host.name,
          online: host.status === "online",
          paused: host.hostInfo?.pause?.paused === true,
          projects: said.projects,
          limit: said.limit,
          running,
        },
      ];
    });
    return offeredHosts({ waiting, sourceHostId: hostId, sourceKey, hosts: facts });
  };
  const run = (target: Elsewhere, moving: Card[]) =>
    startElsewhere({
      t,
      cards: moving,
      sourceHostId: hostId,
      target,
      ask: ((id, type, payload) => store.hostRequest(id, type, payload as never)) as ElsewhereAsk,
    });
  return { load, offers, run };
}
