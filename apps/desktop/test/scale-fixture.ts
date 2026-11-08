import type { EventEnvelope, SessionStatus, SessionSummary } from "@flightdeck/protocol";

/**
 * Issue #1191: a deterministic load for the app. `hosts` hosts with `perHost` sessions each: the
 * mix of a busy machine (working, waiting on a request, finished, failed), in a few projects, and
 * the burst of `session.summary` events a working session sends.
 */
export interface ScaleOptions {
  hosts: number;
  perHost: number;
}

/** The statuses in the mix, in turn: a quarter waits on a request (Needs you). */
const MIX: SessionStatus[] = [
  "running",
  "idle",
  "idle",
  "ended",
  "error",
  "running",
  "idle",
  "idle",
];
const AT = "2026-11-08T10:00:00.000Z";

export const hostId = (h: number) => `host-${h}`;
export const sessionId = (h: number, s: number) => `h${h}-s${String(s).padStart(3, "0")}`;
const cwdOf = (s: number) => `/work/project-${s % 6}`;

function pendingOf(s: number) {
  return s % 4 === 1
    ? [{ requestId: `r-${s}`, toolName: "Bash", createdAt: AT, input: { command: "ls" } }]
    : [];
}

/** The state a connected app holds for the load: its hosts with their sessions, and the hub lists. */
export function scaleState(options: ScaleOptions) {
  const hosts = Array.from({ length: options.hosts }, (_, h) => ({
    id: hostId(h),
    name: `machine ${h}`,
    url: `ws://host-${h}`,
    token: "",
    status: "online" as const,
    info: null,
    hostInfo: { daemonVersion: "x", features: ["review", "names"] },
    incompatibility: null,
    daemonUpdate: null,
    sessions: Array.from({ length: options.perHost }, (_, s) => ({
      id: sessionId(h, s),
      name: `task ${s}`,
      cwd: cwdOf(s),
      status: MIX[s % MIX.length] as SessionStatus,
      pendingPermissions: pendingOf(s),
      updatedAt: AT,
    })),
  }));
  const hub: Record<string, { managed: SessionSummary[]; history: [] }> = {};
  for (const host of hosts) {
    hub[host.id] = {
      managed: host.sessions.map((session) => ({
        id: session.id,
        name: session.name,
        cwd: session.cwd,
        status: session.status,
        permissionMode: "default",
        model: null,
        claudeSessionId: null,
        lastSeq: 0,
        createdAt: AT,
        updatedAt: AT,
      })),
      history: [],
    };
  }
  return { hosts, hub, hostsLoaded: true };
}

/**
 * `count` summaries of one session, as it works: it flips between running and idle, so each one
 * changes what the lists show for that session and for no other.
 */
export function summaryBurst(h: number, s: number, count: number): EventEnvelope[] {
  return Array.from({ length: count }, (_, i) => ({
    type: "event" as const,
    sessionId: sessionId(h, s),
    seq: i + 1,
    ts: AT,
    event: {
      type: "session.summary" as const,
      sessionId: sessionId(h, s),
      name: `task ${s}`,
      cwd: cwdOf(s),
      status: (i % 2 === 0 ? "running" : "idle") as SessionStatus,
      pendingPermissions: [],
      updatedAt: new Date(Date.parse(AT) + (i + 1) * 1000).toISOString(),
    },
  }));
}
