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
  activity: "activity",
  actions: "actions",
  autoApprove: "autoApprove",
  automations: "automations",
  bg: "bg",
  board: "board",
  boardsync: "boardsync",
  budgets: "budgets",
  central: "central",
  costs: "costs",
  fileLog: "logs",
  github: "github",
  history: "history",
  issues: "issues",
  maintenance: "maintenance",
  resources: "resources",
  worktrees: "worktrees",
  names: "names",
  personaSessions: "personaSessions",
  personas: "personas",
  memoryPause: "memoryPause",
  hostPause: "hostPause",
  releases: "releases",
  rewinder: "rewinder",
  roi: "roi",
  runenv: "runEnv",
  summary: "summary",
  telemetry: "telemetry",
  telemetryOptIn: "telemetry",
  terminals: "terminals",
  trace: "trace",
  usage: "usage",
  vault: "vault",
  watch: "prWatch",
  checkLoop: "prWatch",
  webhook: "webhook",
  // Written inline in a case before the split, each with a single name.
  bypass: "bypass",
  serviceInstall: "serviceInstall",
  forker: "forker",
  snapshots: "snapshots",
  ui: "ui.mode",
  updater: "updater",
  updates: "updater",
  // The three teleport services name one feature.
  teleport: "teleport",
  teleportInbox: "teleport",
  teleportImport: "teleport",
} as const satisfies Partial<Record<keyof ServerOptions, string>>;

export type GatedOption = keyof typeof GATES;

/**
 * Issue #1593: the gates of the options grouped by domain, one per service of the group, since a
 * host may run some of a domain's services and not others.
 */
export const GROUP_GATES = {
  harness: {
    stack: "harnessStack",
    preview: "harnessPreview",
    apply: "harnessApply",
    templates: "harnessTemplates",
    draft: "harnessDraft",
    commit: "harnessCommit",
  },
  // The index is gated by the feed but names `knowledge`, and the feed switch names `knowledgeFeed`.
  knowledge: {
    list: "knowledge",
    feed: "knowledge",
    status: "knowledgeStatus",
    create: "knowledgeCreate",
    feedSwitch: "knowledgeFeed",
  },
  ssh: {
    targets: "ssh",
    import: "sshImport",
    hostKeys: "sshHostKeys",
    connect: "sshConnect",
    askpass: "askpass",
  },
  snippets: {
    library: "snippets",
    history: "snippetHistory",
    use: "snippetUse",
  },
  hostChecks: {
    doctor: "doctor.run",
    deps: "depsCheck",
  },
  quota: {
    windows: "quota",
    pause: "quotaPause",
    history: "quotaHistory",
  },
  // The comments were the flat `review` option; each service keeps its flat option's feature.
  review: {
    changes: "changes",
    sessionCommits: "sessionCommits",
    sessionPrs: "sessionPrs",
    comments: "review",
    cardReview: "cardReview",
    files: "files",
    sessionFiles: "sessionFiles",
  },
  agentSetup: {
    agentcfg: "agentcfg",
    mcp: "mcp",
    plugins: "plugins",
    memory: "memory",
    tasks: "tasks",
    templates: "templates",
  },
  messaging: {
    messages: "messaging",
    idle: "idle",
    teams: "teams",
  },
} as const satisfies {
  [G in keyof ServerOptions]?: Record<keyof NonNullable<ServerOptions[G]>, string>;
};

export type GatedGroup = keyof typeof GROUP_GATES;

/** A gated service of a grouped option: a key of both its gate row and its group. */
export type GroupKey<G extends GatedGroup> = keyof (typeof GROUP_GATES)[G] &
  keyof NonNullable<ServerOptions[G]>;

/** A service of a grouped option, as `need` gives a flat one. */
export type GroupService<G extends GatedGroup, K extends GroupKey<G>> = NonNullable<
  NonNullable<ServerOptions[G]>[K]
>;

/** The service behind a gated option; refused with `feature_off` when this host does not run it. */
export function need<K extends GatedOption>(
  opts: ServerOptions,
  key: K,
): NonNullable<ServerOptions[K]> {
  const service = opts[key];
  if (!service) throw featureOff(GATES[key]);
  return service as NonNullable<ServerOptions[K]>;
}

/** The service of a grouped option; refused with `feature_off` when this host does not run it. */
export function needIn<G extends GatedGroup, K extends GroupKey<G>>(
  opts: ServerOptions,
  group: G,
  key: K,
): GroupService<G, K> {
  const service = (opts[group] as Record<PropertyKey, unknown> | undefined)?.[key];
  if (!service) throw featureOff(GROUP_GATES[group][key] as string);
  return service as GroupService<G, K>;
}
