import { describe, expect, test } from "bun:test";
import type { DemoIds } from "../../demo-seed.ts";
import { maintenanceRewriter, maintenanceScript } from "../../lib/shots/maintenance.ts";
import { hostShots } from "../../lib/shots/table-hosts.ts";

/**
 * #4001: the Maintenance panel has a print for each of its states. The demo's hosts read the machine's
 * own database, so the facts, the backup path and the cleanup counts are replaced to read the same
 * on every machine, the first status read can be refused, and the cleanup can stay unanswered.
 */
const IDS = {} as DemoIds;
const ask = (id: string, type: string) => JSON.stringify({ id, type, payload: {} });
const ack = (id: string, data: unknown) => JSON.stringify({ type: "ack", id, ok: true, data });
const heard = (rewriter: ReturnType<typeof maintenanceRewriter>, type: string, data: unknown) => {
  rewriter.fromApp(ask("r1", type));
  const frame = ack("r1", data);
  return rewriter.drops?.(frame) ? null : JSON.parse(rewriter.fromHost(frame));
};

describe("the Maintenance prints (#4001)", () => {
  test("the table prints the panel refused, simulated, asking to clean, cleaning and with a backup made", () => {
    const shots = hostShots(IDS).filter((shot) => shot.name.startsWith("host-manutencao"));
    expect(shots.map((shot) => [shot.name, shot.maintenance])).toEqual([
      ["host-manutencao", undefined],
      ["host-manutencao-recusado", { refuseStatus: true }],
      ["host-manutencao-simulado", {}],
      ["host-manutencao-limpar", {}],
      ["host-manutencao-limpando", { holdClean: true }],
      ["host-manutencao-backup", {}],
    ]);
  });

  test("the status reads the same facts on every machine, a backup and a real cleanup among them", () => {
    const out = heard(maintenanceRewriter(), "maintenance.status", { dbBytes: 1 });
    expect([
      out.data.dbBytes,
      out.data.counts,
      out.data.lastBackup?.path,
      out.data.lastPrune?.dryRun,
    ]).toEqual([
      4_718_592,
      { sessions: 12, events: 18_450, externalSessions: 5 },
      "/home/demo/.flightdeck/backups/flightdeck-2026-11-08.db",
      false,
    ]);
  });

  test("the backup path and the cleanup counts are fixed, not the machine's", () => {
    const rewriter = maintenanceRewriter();
    expect([
      heard(rewriter, "maintenance.backup", { path: "/tmp/x/b.db", at: "now", bytes: 1 }).data.path,
      heard(rewriter, "maintenance.prune", { events: 1 }).data,
    ]).toEqual([
      "/home/demo/.flightdeck/backups/flightdeck-2026-11-09.db",
      { events: 340, permission_requests: 12 },
    ]);
  });

  test("the first status read is refused when asked to, and the next one is answered", () => {
    const rewriter = maintenanceRewriter({ refuseStatus: true });
    const first = heard(rewriter, "maintenance.status", { dbBytes: 1 });
    const second = heard(rewriter, "maintenance.status", { dbBytes: 1 });
    expect([first.ok, first.error?.code, second.ok]).toEqual([false, "failed", true]);
  });

  test("the cleanup is never heard when held, and the backup still is", () => {
    const rewriter = maintenanceRewriter({ holdClean: true });
    expect(heard(rewriter, "maintenance.prune", { events: 1 })).toBeNull();
    expect(heard(rewriter, "maintenance.backup", { path: "x", at: "y", bytes: 1 })).not.toBeNull();
  });

  test("other answers and frames that are not JSON pass as they came", () => {
    const rewriter = maintenanceRewriter({ refuseStatus: true, holdClean: true });
    rewriter.fromApp(ask("r1", "project.list"));
    rewriter.fromApp("not json");
    const other = ack("r1", { projects: [] });
    expect([rewriter.fromHost(other), rewriter.fromHost("{")]).toEqual([other, "{"]);
  });

  test("the init script wraps the page's WebSocket with the rewriter", () => {
    const script = maintenanceScript({ holdClean: true });
    expect([script.includes("WebSocket"), script.includes("holdClean")]).toEqual([true, true]);
  });
});
