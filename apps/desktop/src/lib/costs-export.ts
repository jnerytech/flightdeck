import type { CostsFilter } from "@flightdeck/protocol";
import type { AppStore } from "./app-store.ts";
import { mergeHostCsv } from "./costs-csv.ts";

/**
 * The Costs export. One host: the file its daemon built. Several hosts: one file with the host as
 * its first column, and a host that does not answer is left out. Nothing is saved when no host
 * gave a file.
 */
export async function exportCosts(
  store: Pick<AppStore, "hostCommand" | "saveFile">,
  scope: {
    acrossHosts: boolean;
    hostId: string;
    hosts: ReadonlyArray<{ id: string; name: string }>;
  },
  filter: CostsFilter,
): Promise<void> {
  if (!scope.acrossHosts) {
    const file = await store.hostCommand(scope.hostId, "costs.export", filter);
    if (file) await store.saveFile(file.filename, file.csv);
    return;
  }
  const answers = await Promise.allSettled(
    scope.hosts.map(async (h) => ({
      host: h.name,
      file: await store.hostCommand(h.id, "costs.export", filter),
    })),
  );
  const files = answers.flatMap((answer) => {
    if (answer.status !== "fulfilled" || !answer.value.file) return [];
    return [{ host: answer.value.host, ...answer.value.file }];
  });
  const csv = mergeHostCsv(files);
  const first = files[0];
  if (first && csv !== "") await store.saveFile(first.filename, csv);
}
