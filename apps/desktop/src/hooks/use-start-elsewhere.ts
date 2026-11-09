import type { Card } from "@flightdeck/protocol";
import { useCallback, useRef, useState } from "react";
import type { T } from "../i18n/index.ts";
import type { AppState, AppStore } from "../lib/app-store.ts";
import { cardStartBlock } from "../lib/card-start-block.ts";
import {
  type Elsewhere,
  type ElsewhereAsk,
  type ElsewhereOutcome,
  type HostFacts,
  offeredHosts,
  startElsewhere,
} from "../lib/start-elsewhere.ts";

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
  store: AppStore;
  hostId: string;
  /** The project's key; null while it is not known. */
  sourceKey: string | null;
  hosts: AppState["hosts"];
  cards: AppState["cards"];
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
          key: store.projectKeyOf(host.id, p),
        }));
        // The limit is the host's, so the cards running in all its projects count against it.
        if (projects.some((p) => p.key === sourceKey)) {
          await Promise.all(projects.map((p) => store.loadBoard(host.id, p.id)));
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
