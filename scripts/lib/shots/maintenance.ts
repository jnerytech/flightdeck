import { type FrameRewriter, installHolds } from "./holds.ts";

/** What a Maintenance print asks of the hosts' answers (#4001). */
export interface MaintenanceOptions {
  /** The first read of the status is refused, so the panel shows its error and Try again. */
  refuseStatus?: boolean;
  /** The cleanup is never answered, so Clean stays busy. */
  holdClean?: boolean;
}

/**
 * The demo's hosts read the machine's own database, so its size, its counts and the paths of the
 * backups would differ on every machine. A print of the Maintenance panel wraps the page's sockets
 * with this: the answers to `maintenance.status`, `.backup` and `.prune` carry fixed facts, the first
 * read of the status can be refused, and the cleanup can be left unanswered.
 *
 * It goes into the page as its source (`maintenanceScript`), so it uses nothing outside its own body.
 */
// Not instrumented: its source goes into the page, where an istanbul counter would not exist
// (the istanbul shard of a full run, #1492).
/* istanbul ignore next */
export function maintenanceRewriter(options: MaintenanceOptions = {}): FrameRewriter {
  const parse = (frame: string): Record<string, unknown> | null => {
    try {
      const value: unknown = JSON.parse(frame);
      return typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const folder = "/home/demo/.flightdeck/backups";
  const lastBackup = {
    path: `${folder}/flightdeck-2026-11-08.db`,
    at: "2026-11-08T03:00:00.000Z",
    bytes: 3_145_728,
  };
  const counts = { events: 340, permission_requests: 12 };
  const answers: Record<string, unknown> = {
    "maintenance.status": {
      dbBytes: 4_718_592,
      lastBackup,
      backups: [lastBackup],
      lastPrune: { at: "2026-11-07T03:00:00.000Z", dryRun: false, counts },
      counts: { sessions: 12, events: 18_450, externalSessions: 5 },
    },
    "maintenance.backup": {
      path: `${folder}/flightdeck-2026-11-09.db`,
      at: "2026-11-09T09:00:00.000Z",
      bytes: 3_211_264,
    },
    "maintenance.prune": counts,
  };
  const asked = new Map<string, string>();
  let refused = false;
  return {
    fromApp(frame) {
      const message = parse(frame);
      const type = message?.type;
      if (typeof type === "string" && type in answers && typeof message?.id === "string") {
        asked.set(message.id, type);
      }
      return frame;
    },
    fromHost(frame) {
      const message = parse(frame);
      const id = message?.id;
      const type = typeof id === "string" ? asked.get(id) : undefined;
      if (message?.type !== "ack" || typeof id !== "string" || type === undefined) return frame;
      if (type === "maintenance.prune" && options.holdClean) return frame;
      asked.delete(id);
      if (message.ok !== true) return frame;
      if (type === "maintenance.status" && options.refuseStatus && !refused) {
        refused = true;
        return JSON.stringify({
          type: "ack",
          id,
          ok: false,
          error: { code: "failed", message: "The host did not answer." },
        });
      }
      return JSON.stringify({ ...message, data: answers[type] });
    },
    drops(frame) {
      const message = parse(frame);
      const id = message?.id;
      const type = typeof id === "string" ? asked.get(id) : undefined;
      return message?.type === "ack" && type === "maintenance.prune" && options.holdClean === true;
    },
  };
}

/** The init script a print adds: the page's WebSocket wrapped with `maintenanceRewriter`. */
export function maintenanceScript(options: MaintenanceOptions = {}): string {
  return `(${installHolds.toString()})(window, () => (${maintenanceRewriter.toString()})(${JSON.stringify(options)}));`;
}
