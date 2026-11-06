import type { AppState } from "../src/lib/app-store.ts";

export const NOW = Date.parse("2026-11-05T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
export const MIN = 60_000;
export const HOUR = 60 * MIN;

interface Spec {
  id: string;
  host?: "h1" | "h2";
  cwd?: string;
  status: "running" | "awaiting_permission" | "idle" | "ended";
  agoMs: number;
  name?: string;
  request?: string;
  persona?: { id: string; name: string };
  /** The finished turn was not opened. */
  unread?: boolean;
  risk?: "low" | "high";
  tool?: string;
}

/** Sessions of two hosts as the hub and the live summaries have them. */
export function activityState(specs: Spec[], base: AppState): AppState {
  const hostIds = ["h1", "h2"] as const;
  const hosts = hostIds.map((id) => ({
    id,
    name: id === "h1" ? "alfa" : "beta",
    url: "ws://x",
    token: "",
    status: "online",
    info: null,
    hostInfo: { daemonVersion: "x", features: [] },
    latencyMs: null,
    incompatibility: null,
    daemonUpdate: null,
    sessions: specs
      .filter((s) => (s.host ?? "h1") === id)
      .map((s) => ({
        id: s.id,
        name: s.name ?? s.id,
        cwd: s.cwd ?? "/work/api",
        status: s.status,
        updatedAt: ago(s.agoMs),
        pendingPermissions:
          s.status === "awaiting_permission"
            ? [
                {
                  requestId: `r-${s.id}`,
                  toolName: s.tool ?? "Bash",
                  createdAt: ago(s.agoMs),
                  input: { command: "npm test" },
                  ...(s.risk ? { risk: s.risk } : {}),
                },
              ]
            : [],
      })),
  }));
  const hub = Object.fromEntries(
    hostIds.map((id) => [
      id,
      {
        history: [],
        managed: specs
          .filter((s) => (s.host ?? "h1") === id)
          .map((s) => ({
            id: s.id,
            claudeSessionId: `c-${s.id}`,
            name: s.name ?? s.id,
            cwd: s.cwd ?? "/work/api",
            status: s.status,
            updatedAt: ago(s.agoMs),
            projectKey: `host:${id === "h1" ? "alfa" : "beta"}:${s.cwd ?? "/work/api"}`,
            persona: s.persona ?? null,
            summary: {
              request: s.request ?? null,
              state: s.status === "awaiting_permission" ? "waiting" : s.status,
              tool: null,
              since: ago(s.agoMs),
            },
          })),
      },
    ]),
  );
  const unread = Object.fromEntries(
    specs.filter((s) => s.unread).map((s) => [`${s.host ?? "h1"}/${s.id}`, true as const]),
  );
  return { ...base, hosts, hub, unread } as never as AppState;
}
