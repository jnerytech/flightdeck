/**
 * Issue #248: the server's feature gates. A command whose service this host does not run is refused
 * with `feature_off` and the feature's name; the app translates that name (`daemonFeature`), so each
 * option keeps the string its accessor threw before the split, even where the two differ.
 */
import { featureOff } from "../errors.ts";
import type { ServerOptions } from "../server.ts";

/** Each gated option, and the feature named when it is off. */
export const GATES = {
  account: "account",
  actions: "actions",
  agentcfg: "agentcfg",
  askpass: "askpass",
  autoApprove: "autoApprove",
  automations: "automations",
  bg: "bg",
  board: "board",
  boardsync: "boardsync",
  budgets: "budgets",
  central: "central",
  changes: "changes",
  sessionCommits: "sessionCommits",
  sessionPrs: "sessionPrs",
  costs: "costs",
  files: "files",
  fileLog: "logs",
  github: "github",
  history: "history",
  idle: "idle",
  issues: "issues",
  maintenance: "maintenance",
  resources: "resources",
  worktrees: "worktrees",
  mcp: "mcp",
  memory: "memory",
  messaging: "messaging",
  names: "names",
  personaSessions: "personaSessions",
  personas: "personas",
  plugins: "plugins",
  quota: "quota",
  quotaPause: "quotaPause",
  releases: "releases",
  quotaHistory: "quotaHistory",
  review: "review",
  rewinder: "rewinder",
  roi: "roi",
  runenv: "runEnv",
  sessionFiles: "sessionFiles",
  snippetHistory: "snippetHistory",
  snippetUse: "snippetUse",
  snippets: "snippets",
  ssh: "ssh",
  sshConnect: "sshConnect",
  sshHostKeys: "sshHostKeys",
  sshImport: "sshImport",
  summary: "summary",
  teams: "teams",
  telemetry: "telemetry",
  telemetryOptIn: "telemetry",
  terminals: "terminals",
  trace: "trace",
  usage: "usage",
  vault: "vault",
  watch: "prWatch",
  webhook: "webhook",
  // Written inline in a case before the split, each with a single name.
  bypass: "bypass",
  doctor: "doctor.run",
  serviceInstall: "serviceInstall",
  forker: "forker",
  snapshots: "snapshots",
  tasks: "tasks",
  templates: "templates",
  ui: "ui.mode",
  updater: "updater",
  updates: "updater",
} as const satisfies Partial<Record<keyof ServerOptions, string>>;

export type GatedOption = keyof typeof GATES;

/** The service behind a gated option; refused with `feature_off` when this host does not run it. */
export function need<K extends GatedOption>(
  opts: ServerOptions,
  key: K,
): NonNullable<ServerOptions[K]> {
  const service = opts[key];
  if (!service) throw featureOff(GATES[key]);
  return service as NonNullable<ServerOptions[K]>;
}
