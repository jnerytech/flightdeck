import type { CostsFilter } from "@flightdeck/protocol";
import type { AppStore } from "../../lib/app-store.ts";
import { mergeHostCsv } from "./domain/costs-csv.ts";
import type { CostsExport } from "./domain/costs-export-note.ts";

/**
 * The Costs export. One host: the file its daemon built. Several hosts: one file with the host as
 * its first column, and a host that does not answer is left out. Nothing is saved when no host
 * gave a file.
 */
export async function exportCosts(
  store: Pick<AppStore, "hostCommand" | "system">,
  scope: {
    acrossHosts: boolean;
    hostId: string;
    hosts: ReadonlyArray<{ id: string; name: string }>;
  },
  filter: CostsFilter,
): Promise<CostsExport> {
  const nameOf = (id: string) => scope.hosts.find((h) => h.id === id)?.name ?? id;
  if (!scope.acrossHosts) {
    const file = await store.hostCommand(scope.hostId, "costs.export", filter);
    if (!file) return { kind: "nothing", left: [nameOf(scope.hostId)] };
    return (await store.system.saveFile(file.filename, file.csv))
      ? { kind: "saved", filename: file.filename, left: [] }
      : { kind: "cancelled" };
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
  const given = new Set(files.map((f) => f.host));
  const left = scope.hosts.map((h) => h.name).filter((name) => !given.has(name));
  const csv = mergeHostCsv(files);
  const first = files[0];
  if (!first || csv === "") return { kind: "nothing", left };
  return (await store.system.saveFile(first.filename, csv))
    ? { kind: "saved", filename: first.filename, left }
    : { kind: "cancelled" };
}
