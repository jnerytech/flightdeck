import { describe, expect, test } from "bun:test";
import { FlightdeckError } from "../src/errors.ts";
import { GATES, type GatedOption, need } from "../src/server/gates.ts";
import type { ServerOptions } from "../src/server.ts";

/**
 * The feature each gated option names when it is off, as the accessors of `startServer` threw it
 * before the split (issue #248). The app translates these names, so none may change; seven differ
 * from their option. `findProjects` names its command (`projects.scan`, `projects.clone`), so it
 * stays a check of its own in those two handlers.
 */
const BEFORE_THE_SPLIT: Record<string, string> = {
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
  costs: "costs",
  files: "files",
  github: "github",
  history: "history",
  idle: "idle",
  issues: "issues",
  maintenance: "maintenance",
  mcp: "mcp",
  memory: "memory",
  messaging: "messaging",
  names: "names",
  personaSessions: "personaSessions",
  personas: "personas",
  plugins: "plugins",
  quota: "quota",
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
  // The gates written inline in a case before the split, each with a single name.
  bypass: "bypass",
  doctor: "doctor.run",
  forker: "forker",
  snapshots: "snapshots",
  tasks: "tasks",
  templates: "templates",
  ui: "ui.mode",
  updater: "updater",
  updates: "updater",
};

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
    expect({ ...GATES }).toEqual(BEFORE_THE_SPLIT);
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
});
