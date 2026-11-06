import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FlightdeckError } from "../src/errors.ts";
import { opencodeConfig, opencodeRules } from "../src/runtime/opencode-config.ts";
import {
  maskResource,
  OpenCodePreflight,
  PREFLIGHT_CACHE_MS,
  type PreflightDeps,
} from "../src/runtime/opencode-preflight.ts";
import { globalConfigDir } from "../src/runtime/opencode-scope.ts";

// The global folder as the code computes it here (backslashes on Windows).
const GLOBAL = globalConfigDir({ HOME: "/home/u" });
const RULES = opencodeRules();
const PLAN = [...RULES, { action: "edit", resource: "*", effect: "deny" }];
const SUFFIX = [
  { action: "browser", resource: "*", effect: "deny" },
  { action: "skill", resource: "browser", effect: "deny" },
];
const base = [{ action: "*", resource: "*", effect: "allow" }];

const agent = (id: string, permissions: unknown[], hidden = false) => ({ id, hidden, permissions });
const goodAgents = () => [
  agent("flightdeck", [...base, ...RULES, ...SUFFIX]),
  agent("flightdeck-plan", [...base, ...PLAN, ...SUFFIX]),
  agent("compaction", base, true),
  agent("title", base, true),
  agent("summary", base, true),
];
const goodConfig = () => [
  { type: "directory", path: GLOBAL },
  { type: "document", info: {} },
];

interface Answers {
  config?: unknown;
  agents?: unknown[] | ((content: string) => unknown[]);
  saved?: unknown[];
  fail?: string;
}

function setup(answers: Answers = {}, over: Partial<PreflightDeps> = {}) {
  const calls: Array<{
    argv: string[];
    cwd: string;
    env: Record<string, string>;
    timeoutMs: number;
  }> = [];
  let clock = 1000;
  const deps: PreflightDeps = {
    path: "/bin/opencode",
    version: "2.2.5",
    env: { HOME: "/home/u", PATH: "/bin", OPENCODE_DB: "/x" },
    scan: async () => ({ findings: [], fingerprint: "fp1" }),
    now: () => clock,
    run: async (argv, opts) => {
      calls.push({ argv, ...opts });
      const route = argv[3] ?? "";
      if (answers.fail && route.includes(answers.fail)) return { exitCode: 1, stdout: "" };
      const body =
        route === "/api/config"
          ? (answers.config ?? goodConfig())
          : route === "/api/agent"
            ? {
                data:
                  typeof answers.agents === "function"
                    ? answers.agents(opts.env.OPENCODE_CONFIG_CONTENT ?? "")
                    : (answers.agents ?? goodAgents()),
              }
            : { data: answers.saved ?? [] };
      return { exitCode: 0, stdout: JSON.stringify(body) };
    },
    ...over,
  };
  return {
    preflight: new OpenCodePreflight(deps),
    calls,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof FlightdeckError
      ? { reason: error.reason, params: error.params }
      : { other: String(error) };
  }
}

describe("opencode-preflight", () => {
  test("a clean folder passes with our document; the three checks run in the folder, with project config off, each for up to 30 s", async () => {
    const { preflight, calls } = setup();
    expect(await preflight.check("/w")).toEqual({
      configContent: JSON.stringify(opencodeConfig()),
    });
    expect(calls.map((c) => c.argv.slice(1).join(" ")).sort()).toEqual([
      "api GET /api/agent --standalone",
      "api GET /api/config --standalone",
      "api GET /api/permission/saved --standalone",
    ]);
    for (const call of calls) {
      // Each check boots a private server: 8 to 15 s on a busy Raspberry Pi 5 (2026-11-05).
      expect([
        call.cwd,
        call.env.OPENCODE_DISABLE_PROJECT_CONFIG,
        call.env.OPENCODE_DB,
        call.timeoutMs,
      ]).toEqual(["/w", "1", undefined, 30_000]);
    }
  });

  test("an unsafe global scope refuses before any OpenCode process runs", async () => {
    const findings = [
      { kind: "mcp_server" as const, path: `${GLOBAL}/opencode.json`, detail: "ctx" },
    ];
    const { preflight, calls } = setup({}, { scan: async () => ({ findings, fingerprint: "x" }) });
    expect(await refusal(preflight.check("/w"))).toEqual({
      reason: "opencode_unsafe_global",
      params: { version: "2.2.5", found: `mcp_server ctx (${GLOBAL}/opencode.json)` },
    });
    expect(calls).toEqual([]);
  });

  test("a config source other than the global folder and our document refuses, naming it", async () => {
    const { preflight } = setup({
      config: [...goodConfig(), { type: "document", path: "/w/opencode.json" }],
    });
    expect(await refusal(preflight.check("/w"))).toEqual({
      reason: "opencode_config_outranks",
      params: { version: "2.2.5", what: "/w/opencode.json" },
    });
  });

  test("the global folder's own config files are allowed as documents; another file in it is not", async () => {
    for (const name of ["opencode.json", "opencode.jsonc", "config.json"]) {
      const config = [
        { type: "document", path: join(GLOBAL, name), info: { model: "a/b" } },
        ...goodConfig(),
      ];
      expect(await refusal(setup({ config }).preflight.check("/w"))).toBe(null);
    }
    const other = [{ type: "document", path: join(GLOBAL, "extra.json") }, ...goodConfig()];
    expect((await refusal(setup({ config: other }).preflight.check("/w")))?.params).toEqual({
      version: "2.2.5",
      what: join(GLOBAL, "extra.json"),
    });
  });

  test("our agents must end with our rules followed only by denies", async () => {
    const allowAfter = goodAgents().map((a) =>
      a.id === "flightdeck"
        ? agent("flightdeck", [...RULES, { action: "shell", resource: "*", effect: "allow" }])
        : a,
    );
    expect(await refusal(setup({ agents: allowAfter }).preflight.check("/w"))).toEqual({
      reason: "opencode_config_outranks",
      params: { version: "2.2.5", what: "flightdeck" },
    });
    const missing = goodAgents().filter((a) => a.id !== "flightdeck-plan");
    expect(await refusal(setup({ agents: missing }).preflight.check("/w"))).toEqual({
      reason: "opencode_config_outranks",
      params: { version: "2.2.5", what: "flightdeck-plan" },
    });
  });

  test("an extra global agent is disabled by id and checked again; still visible refuses", async () => {
    const extra = (content: string) =>
      content.includes('"reviewer":{"disabled":true}')
        ? goodAgents()
        : [...goodAgents(), agent("reviewer", base)];
    const { preflight } = setup({ agents: extra });
    const { configContent } = await preflight.check("/w");
    expect(configContent).toBe(JSON.stringify(opencodeConfig(["reviewer"])));
    const stubborn = setup({ agents: [...goodAgents(), agent("reviewer", base)] });
    expect(await refusal(stubborn.preflight.check("/w"))).toEqual({
      reason: "opencode_config_outranks",
      params: { version: "2.2.5", what: "reviewer" },
    });
    // A hidden agent that is not one of OpenCode's own internal ones counts too.
    const hidden = setup({ agents: [...goodAgents(), agent("sneaky", base, true)] });
    expect((await refusal(hidden.preflight.check("/w")))?.params).toEqual({
      version: "2.2.5",
      what: "sneaky",
    });
  });

  test("saved rules refuse with the masked rules and the exact commands to remove them", async () => {
    const saved = [
      { id: "psv_1", action: "shell", resource: "echo *" },
      {
        id: "psv_2",
        action: "shell",
        resource:
          "curl -H token:ghp_abcdefghijklmnopqrstuvwxyz0123 https://example.com/very/long/path",
      },
    ];
    expect(await refusal(setup({ saved }).preflight.check("/w"))).toEqual({
      reason: "opencode_saved_rules",
      params: {
        version: "2.2.5",
        rules: "shell echo *\nshell curl -H token:••• https:•••",
        commands:
          "opencode api DELETE /api/permission/saved/psv_1\nopencode api DELETE /api/permission/saved/psv_2",
      },
    });
  });

  test("a failed, timed-out or unreadable check refuses as a failed preflight", async () => {
    expect((await refusal(setup({ fail: "/api/agent" }).preflight.check("/w")))?.reason).toBe(
      "opencode_preflight_failed",
    );
    expect(
      (await refusal(setup({ config: { not: "a list" } }).preflight.check("/w")))?.reason,
    ).toBe("opencode_preflight_failed");
    const thrown = setup(
      {},
      {
        run: async () => {
          throw new Error("timeout");
        },
      },
    );
    expect(await refusal(thrown.preflight.check("/w"))).toEqual({
      reason: "opencode_preflight_failed",
      params: { version: "2.2.5" },
    });
  });

  test("a failed preflight is logged with the route and its exit code, never what OpenCode printed", async () => {
    const logs: string[] = [];
    const log = (message: string) => logs.push(message);
    await refusal(setup({ fail: "/api/agent" }, { log }).preflight.check("/w"));
    const notJson = setup(
      {},
      { log, run: async () => ({ exitCode: 0, stdout: "secret-looking text" }) },
    );
    await refusal(notJson.preflight.check("/w"));
    await refusal(setup({ config: { not: "a list" } }, { log }).preflight.check("/w"));
    expect(logs).toEqual([
      "opencode preflight failed in /w: /api/agent exited 1",
      "opencode preflight failed in /w: /api/config answered something that is not JSON",
      "opencode preflight failed in /w: a check could not run, or its answer had an unexpected shape",
    ]);
  });

  test("a pass is cached per folder and scope fingerprint for 10 minutes; a refusal is not", async () => {
    const { preflight, calls, tick } = setup();
    await preflight.check("/w");
    await preflight.check("/w");
    expect(calls.length).toBe(3);
    await preflight.check("/other");
    expect(calls.length).toBe(6);
    tick(PREFLIGHT_CACHE_MS + 1);
    await preflight.check("/w");
    expect(calls.length).toBe(9);
    let fingerprint = "a";
    const changing = setup({}, { scan: async () => ({ findings: [], fingerprint }) });
    await changing.preflight.check("/w");
    fingerprint = "b";
    await changing.preflight.check("/w");
    expect(changing.calls.length).toBe(6);
    const refused = setup({ saved: [{ id: "p", action: "shell", resource: "x" }] });
    await refusal(refused.preflight.check("/w"));
    await refusal(refused.preflight.check("/w"));
    expect(refused.calls.length).toBe(6);
  });

  test("the answers recorded from OpenCode 2.2.5 pass as they are", async () => {
    const fixture = (name: string) =>
      readFileSync(join(import.meta.dir, "fixtures", "opencode-acp", name), "utf8");
    const calls: string[] = [];
    const preflight = new OpenCodePreflight({
      path: "/bin/opencode",
      version: "2.2.5",
      env: { HOME: "/home/u" },
      scan: async () => ({ findings: [], fingerprint: "fp" }),
      run: async (argv) => {
        const route = argv[3] ?? "";
        calls.push(route);
        const stdout =
          route === "/api/config"
            ? fixture("api-config.json").replace(
                '"/home/u/.config/opencode"',
                JSON.stringify(GLOBAL),
              )
            : route === "/api/agent"
              ? fixture("api-agent.json")
              : JSON.stringify({ data: [] });
        return { exitCode: 0, stdout };
      },
    });
    expect(await refusal(preflight.check("/work/project"))).toBe(null);
    const saved = JSON.parse(fixture("api-permission-saved.json")) as { data: unknown[] };
    expect(await refusal(setup({ saved: saved.data }).preflight.check("/w"))).toMatchObject({
      reason: "opencode_saved_rules",
    });
  });

  test("a saved rule's id that is not a plain id is left out of the commands; its action is masked too", async () => {
    const saved = [
      { id: "psv_1;rm -rf ~", action: "shell", resource: "echo *" },
      { id: "psv_2", action: "x ".repeat(30), resource: "y" },
    ];
    expect((await refusal(setup({ saved }).preflight.check("/w")))?.params).toEqual({
      version: "2.2.5",
      rules: `shell echo *\n${"x ".repeat(20)}… y`,
      commands: "opencode api DELETE /api/permission/saved/psv_2",
    });
  });

  test("two checks of one folder at once share one run of the three commands", async () => {
    const { preflight, calls } = setup();
    await Promise.all([preflight.check("/w"), preflight.check("/w")]);
    expect(calls.length).toBe(3);
  });

  test("a binary replaced since the daemon checked it refuses until it is checked again", async () => {
    let now = "100:5";
    const { preflight, calls } = setup(
      {},
      { exe: { fingerprint: "100:5", current: async () => now } },
    );
    expect(await refusal(preflight.check("/w"))).toBe(null);
    now = "200:9";
    expect(await refusal(preflight.check("/other"))).toEqual({
      reason: "opencode_changed",
      params: { version: "2.2.5" },
    });
    expect(calls.length).toBe(3);
  });

  test("maskResource cuts at 40 characters and hides token-like runs", () => {
    expect(maskResource("git push *")).toBe("git push *");
    expect(maskResource("export KEY=sk_live_0123456789abcdefABCDEF")).toBe("export KEY=•••");
    expect(maskResource("a".repeat(10) + " " + "b".repeat(50))).toBe(`${"a".repeat(10)} •••`);
    expect(maskResource("x ".repeat(30))).toBe(`${"x ".repeat(20)}…`);
    expect(maskResource("auth eyJhbGciOi.J9.eyJzdWIi+Q/x== done")).toBe("auth ••• done");
  });
});
