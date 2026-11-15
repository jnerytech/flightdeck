import { useEffect, useState } from "react";
import { useKeyed } from "@/shared/hooks/index.ts";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import type { HubRow } from "./domain/hub.ts";
import { costAsks } from "./domain/hub-derive.ts";

/** Estimated cost of each row's session, by row key (hosts with costs, phase 8). */
export function useHubCosts(store: AppStore, hosts: AppState["hosts"], rows: readonly HubRow[]) {
  const [costs, setCosts] = useState<Record<string, number>>({});
  const asked = useKeyed(costAsks(hosts, rows));
  useEffect(() => {
    void Promise.all(
      asked.map(async ([hostId, ids]) => {
        const result = await store.hostCommand(hostId, "costs.sessions", {
          claudeSessionIds: ids.slice(0, 500),
        });
        return Object.entries(result?.costs ?? {}).map(([id, cost]) => [`${hostId}/${id}`, cost]);
      }),
    ).then((all) => setCosts(Object.fromEntries(all.flat())));
  }, [store, asked]);
  return costs;
}
