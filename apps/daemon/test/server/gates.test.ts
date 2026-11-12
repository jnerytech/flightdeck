import { describe, expect, test } from "bun:test";
import { FlightdeckError } from "../../src/errors.ts";
import {
  GATES,
  type GatedGroup,
  type GatedOption,
  GROUP_GATES,
  type GroupKey,
  need,
  needIn,
} from "../../src/server/gates.ts";
import type { ServerOptions } from "../../src/server.ts";

/**
 * The feature each gated option names when it is off, as the accessors of `startServer` threw it
 * before the split (issue #248). The app translates these names, so none may change; seven differ
 * from their option. `findProjects` names its command (`projects.scan`, `projects.clone`), so it
 * stays a check of its own in those two handlers.
 */
const BEFORE_THE_SPLIT: Record<string, string> = {
  account: "account",
  activity: "activity",
  actions: "actions",
  autoApprove: "autoApprove",
  automations: "automations",
  bg: "bg",
  board: "board",
  boardsync: "boardsync",
  central: "central",
  fileLog: "logs",
  github: "github",
  history: "history",
  issues: "issues",
  maintenance: "maintenance",
  resources: "resources",
  worktrees: "worktrees",
  names: "names",
  memoryPause: "memoryPause",
  hostPause: "hostPause",
  releases: "releases",
  rewinder: "rewinder",
  roi: "roi",
  runenv: "runEnv",
  summary: "summary",
  terminals: "terminals",
  trace: "trace",
  usage: "usage",
  vault: "vault",
  watch: "prWatch",
  checkLoop: "prWatch",
  webhook: "webhook",
  // The gates written inline in a case before the split, each with a single name.
  serviceInstall: "serviceInstall",
  forker: "forker",
  snapshots: "snapshots",
  ui: "ui.mode",
  updater: "updater",
  updates: "updater",
};

/**
 * The options grouped by domain (#1593), each service with the feature its flat option named. The
 * knowledge gates moved out of the switch with the knowledge domain (issue #1288): the index is
 * gated by the feed but names `knowledge`, and the feed switch names `knowledgeFeed`.
 */
const GROUPED: Record<string, Record<string, string>> = {
  harness: {
    stack: "harnessStack",
    preview: "harnessPreview",
    apply: "harnessApply",
    templates: "harnessTemplates",
    draft: "harnessDraft",
    commit: "harnessCommit",
  },
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
  // `doctor.run` was a flat gate; `deps.check` refused inline as `depsCheck` before the group.
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
  // The messages between sessions keep `messaging`; the idle notices and the teams keep theirs.
  messaging: {
    messages: "messaging",
    idle: "idle",
    teams: "teams",
  },
  // The session settings' switches keep the names `host.bypass` and `host.sleep` refused with.
  sessionSettings: {
    bypass: "bypass",
    sleep: "sleep",
  },
  // The teleport gates moved out of the switch with the teleport domain (issue #1288): the three
  // services name one feature.
  teleport: {
    packages: "teleport",
    inbox: "teleport",
    imports: "teleport",
  },
  // The personas and what applies one to an open session (#1593): each keeps its flat name.
  personas: {
    store: "personas",
    sessions: "personaSessions",
  },
  // The costs and their budgets (#1593): each keeps its flat name.
  costs: {
    costs: "costs",
    budgets: "budgets",
  },
  // The telemetry's timings and its opt-in (#1593): both keep `telemetry`.
  telemetry: {
    store: "telemetry",
    optIn: "telemetry",
  },
};

/** What `needIn` answers for a grouped service: the service, or the refusal's reason and feature. */
function groupOutcome(opts: ServerOptions, group: string, key: string): unknown {
  try {
    return needIn(opts, group as GatedGroup, key as GroupKey<GatedGroup>);
  } catch (error) {
    return error instanceof FlightdeckError
      ? { reason: error.reason, feature: error.params?.feature }
      : String(error);
  }
}

/** What `need` answers for an option: the service, or the refusal's reason and feature. */
function outcome(opts: ServerOptions, key: GatedOption): unknown {
  try {
    return need(opts, key);
  } catch (error) {
    return error instanceof FlightdeckError
      ? { reason: error.reason, feature: error.params?.feature }
      : String(error);
  }
}

describe("server-gates", () => {
  test("every gated option names the same feature as before the split", () => {
    expect({ ...GATES } as Record<string, string>).toEqual(BEFORE_THE_SPLIT);
  });

  test("an option the host does not run is refused as feature_off with its feature; one it runs is returned", () => {
    const off = {} as ServerOptions;
    const keys = Object.keys(BEFORE_THE_SPLIT) as GatedOption[];
    expect(keys.map((key) => [key, outcome(off, key)])).toEqual(
      keys.map((key) => [key, { reason: "feature_off", feature: BEFORE_THE_SPLIT[key] }]),
    );
    const board = { name: "board" };
    expect(outcome({ board } as unknown as ServerOptions, "board")).toBe(board);
  });

  test("a grouped service names the same feature as its flat option did, and one the host runs is returned", () => {
    expect(JSON.parse(JSON.stringify(GROUP_GATES))).toEqual(GROUPED);
    const off = {} as ServerOptions;
    const offIn = {
      knowledge: {},
      harness: {},
      ssh: {},
      snippets: {},
      hostChecks: {},
      quota: {},
      review: {},
      agentSetup: {},
      messaging: {},
      sessionSettings: {},
      teleport: {},
      personas: {},
      costs: {},
      telemetry: {},
    } as ServerOptions;
    const named = Object.entries(GROUPED).flatMap(([group, keys]) =>
      Object.entries(keys).map(([key, feature]) => [group, key, feature] as const),
    );
    const refused = (opts: ServerOptions) =>
      named.map(([group, key]) => [group, key, groupOutcome(opts, group, key)]);
    const expected = named.map(([group, key, feature]) => [
      group,
      key,
      { reason: "feature_off", feature },
    ]);
    expect([refused(off), refused(offIn)]).toEqual([expected, expected]);
    const list = async () => ({ entries: [] });
    expect(
      groupOutcome({ knowledge: { list } } as unknown as ServerOptions, "knowledge", "list"),
    ).toBe(list);
    const stack = async () => ({ commands: [] });
    expect(
      groupOutcome({ harness: { stack } } as unknown as ServerOptions, "harness", "stack"),
    ).toBe(stack);
  });
});
