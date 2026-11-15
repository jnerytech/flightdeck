import type { TeamInfo, TeamStatus } from "@flightdeck/protocol";
import { inSequence } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import { useMinLoading } from "@/shared/hooks/index.ts";
import type { AppStore } from "../../lib/app-store.ts";

/** The teams of a host and the state of each, reloaded when the host says they changed. */
export function useTeamsList(store: AppStore, current: string) {
  /** `null` until `teams.list` answers: an empty list is an answer, not the absence of one (#2647). */
  const [teams, setTeams] = useState<TeamInfo[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const loading = useMinLoading(teams === null && !loadFailed);
  const [statuses, setStatuses] = useState<Record<string, TeamStatus>>({});
  const load = useCallback(async () => {
    if (!current) return;
    // A retry shows the loading shape again, so the person sees it was taken.
    setLoadFailed(false);
    // The page has its own retry, so the toast offers none that would throw the answer away.
    const list = await store.hostCommand(current, "teams.list", {}, { retry: false });
    // `hostCommand` raises the toast with the reason and answers null for a refused request.
    setLoadFailed(!list);
    if (!list) return;
    setTeams(list.teams);
    // The workers' branches are on their cards: the page asks for its teams' boards, as the app
    // may open here first (#1220), without holding the teams' states back.
    void inSequence([...new Set(list.teams.map((team) => team.projectId))], (projectId) =>
      store.boardCards.load(current, projectId),
    );
    const next: Record<string, TeamStatus> = {};
    await inSequence(list.teams, async (team) => {
      const status = await store.hostCommand(current, "teams.status", { team: team.id });
      if (status) next[team.id] = status;
    });
    setStatuses(next);
  }, [store, current]);
  useEffect(() => {
    if (current) void store.projectList.load(current);
    void load();
    return store.teams.onUpdated(() => void load());
  }, [store, current, load]);
  return { teams, loadFailed, loading, statuses, load };
}
