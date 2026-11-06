#!/usr/bin/env bun
/**
 * The real OpenCode, opt-in (phase 39): `bun run smoke:opencode-real [--model <id>]`. Never in the
 * suite or CI; run on a host with OpenCode installed and signed in, at each OpenCode upgrade.
 *
 * It builds a hostile project in a scratch folder (scripts/lib/opencode-real.ts: a plugin, an MCP
 * server and a `/hello` command that each leave a marker, allow-all rules, an agent named
 * `flightdeck`), with a scratch XDG_CONFIG_HOME, and checks against the real OpenCode through a
 * daemon: the host lists OpenCode (its canary passed); a session in that project asks before its
 * first shell command; a neutralized `/hello` does not run; no marker appears; a saved `always`
 * rule (made by answering one request directly over ACP) makes the preflight refuse, and once it
 * is removed the preflight passes. The OpenCode sessions and the saved rules it made are deleted at
 * the end. It never reads OpenCode's credentials: OpenCode reads its own, with the person's HOME.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { HostInfoResult } from "@flightdeck/protocol";
import { AcpClient, spawnAcp } from "../apps/daemon/src/runtime/acp/client.ts";
import { opencodeConfig, opencodeEnv } from "../apps/daemon/src/runtime/opencode-config.ts";
import { fileExists, resolveOpenCodePath } from "../apps/daemon/src/runtime/opencode-discovery.ts";
import { FrameClient } from "../apps/daemon/test/history-helpers.ts";
import {
  alwaysOptionId,
  hostileFiles,
  MARKERS,
  markerPath,
  parseRealArgs,
  savedRuleIds,
} from "./lib/opencode-real.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

const { model } = parseRealArgs(process.argv.slice(2));
const guard = installClaudeGuard();
const TOKEN = "smoke-opencode-real-token-0123456789";
const TURN_MS = 240_000;
const ROOT = resolve(import.meta.dir, "..");

/**
 * The daemon as its own process, as a host runs it: started in this process, its MCP entry for
 * OpenCode would name this script (Bun.main), and OpenCode would run the smoke again as the server.
 */
/** Each daemon's output, kept in the scratch folder for the failure message. */
const daemonLogs: string[] = [];

async function startDaemon(config: string) {
  const logFile = join(dirname(config), `daemon-${daemonLogs.length + 1}.log`);
  daemonLogs.push(logFile);
  const child = Bun.spawn(
    [
      process.execPath,
      "run",
      join(ROOT, "apps/daemon/src/bin.ts"),
      "start",
      "--config",
      config,
      "--runtime",
      "claude",
    ],
    { env, stdout: Bun.file(logFile), stderr: Bun.file(`${logFile}.err`) },
  );
  const read = () => (existsSync(logFile) ? readFileSync(logFile, "utf8") : "");
  const url = await until(
    () => /listening on (ws:\/\/\S+)/.exec(read())?.[1] ?? (child.exitCode !== null && "exited"),
    "the daemon's address",
    60_000,
  );
  if (url === "exited") throw new Error(`the daemon exited: ${read()}`);
  return {
    url,
    stop: async () => {
      child.kill();
      await child.exited;
    },
  };
}

/** What the daemons said about OpenCode (the preflight logs why it failed). */
function daemonOpenCodeLines(): string[] {
  return daemonLogs.flatMap((file) =>
    [file, `${file}.err`]
      .filter((f) => existsSync(f))
      .flatMap((f) => readFileSync(f, "utf8").split(/\r?\n/))
      .filter((line) => /opencode/i.test(line)),
  );
}

let step = "prepare";
const log = (msg: string) => console.log(`  · ${msg}`);

async function until<T>(
  check: () => T | null | undefined | false,
  what: string,
  ms = TURN_MS,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await Bun.sleep(100);
  }
}

interface Event {
  type: string;
  requestId?: string;
  toolName?: string;
}

const exe = await resolveOpenCodePath(undefined, {
  env: process.env as Record<string, string>,
  platform: process.platform,
  which: (bin) => Bun.which(bin, { PATH: process.env.PATH ?? "" }),
  exists: fileExists,
});
const scratch = realTempDir("flightdeck-smoke-opencode-real-");
const markers = join(scratch, "markers");
const root = join(scratch, "root");
const project = join(root, "hostile");
const xdg = join(scratch, "config");
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined && !/^OPENCODE_/i.test(key)) env[key] = value;
}
env.XDG_CONFIG_HOME = xdg;
/** What an OpenCode process of Flightdeck's gets, for the direct ACP session and the API calls. */
const childEnv = opencodeEnv(env, JSON.stringify(opencodeConfig()));
/** What the current daemon session did, for the failure message. */
let trace: () => string = () => "";

function opencode(args: string[]) {
  const run = Bun.spawnSync([exe ?? "opencode", ...args], { cwd: project, env: childEnv });
  return { code: run.exitCode, stdout: run.stdout.toString() };
}

function savedRules(): string[] {
  return savedRuleIds(opencode(["api", "GET", "/api/permission/saved", "--standalone"]).stdout);
}

function prepare(): string {
  mkdirSync(markers, { recursive: true });
  mkdirSync(xdg, { recursive: true });
  for (const [path, content] of Object.entries(hostileFiles(markers))) {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), content);
  }
  // Its own git root gives the folder its own OpenCode project, so its saved rules are its own.
  const git = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: project, env });
  git(["init", "-q"]);
  git([
    "-c",
    "user.name=smoke",
    "-c",
    "user.email=smoke@localhost",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  ]);
  const config = join(scratch, "config.json");
  writeFileSync(
    config,
    JSON.stringify({
      port: 0,
      token: TOKEN,
      dataDir: join(scratch, "data"),
      allowedRoots: [root],
      claude: { executablePath: join(scratch, "no-claude") },
      opencode: { enabled: true, executablePath: exe },
    }),
  );
  return config;
}

async function connect(url: string) {
  const client = new FrameClient(url);
  await client.request("hello", { token: TOKEN, client: "smoke-opencode-real" });
  const events = (sessionId: string) =>
    client.frames
      .filter((f) => f.type === "event" && f.sessionId === sessionId)
      .map((f) => f.event as Event);
  return { client, events };
}

/** Answers one request with `always` over ACP, so the project gets a saved rule. */
async function saveARule(): Promise<void> {
  const agent = spawnAcp([exe ?? "opencode", "acp"], { cwd: project, env: childEnv });
  const acp = new AcpClient(agent, {
    requests: {
      "session/request_permission": async (params) => {
        const options = (params as { options?: Array<{ optionId: string; kind: string }> }).options;
        const optionId = alwaysOptionId(options ?? []);
        return optionId
          ? { outcome: { outcome: "selected", optionId } }
          : { outcome: { outcome: "cancelled" } };
      },
    },
  });
  try {
    await acp.request("initialize", { protocolVersion: 1, clientCapabilities: {} });
    const { sessionId } = await acp.request<{ sessionId: string }>("session/new", {
      cwd: project,
      mcpServers: [],
    });
    await acp.request("session/set_config_option", { sessionId, configId: "model", value: model });
    await acp.request(
      "session/prompt",
      {
        sessionId,
        prompt: [
          { type: "text", text: "Run the shell command `echo fd-saved` and say what it printed." },
        ],
      },
      { timeoutMs: TURN_MS },
    );
    await acp.request("session/close", { sessionId }).catch(() => undefined);
  } finally {
    agent.close();
    agent.kill();
  }
}

async function run(): Promise<void> {
  if (!exe) throw new Error("no opencode on PATH or in ~/.opencode/bin");
  const config = prepare();
  const start = () => startDaemon(config);
  let daemon = await start();
  let { client, events } = await connect(daemon.url);
  try {
    step = "the host lists the real OpenCode (its canary passed)";
    const info = await client.data<HostInfoResult>("host.info", {});
    const opencodeInfo = info?.runtimes?.find((r) => r.kind === "opencode");
    if (!opencodeInfo?.available) throw new Error(`unavailable: ${opencodeInfo?.reason}`);
    log(`OpenCode ${opencodeInfo.version} (verified: ${opencodeInfo.verified}) at ${exe}`);

    step = "a session in the hostile project asks before its first shell command";
    const created = await client.request("session.create", {
      cwd: project,
      runtime: "opencode",
      model,
      prompt: "Run the shell command `echo fd-smoke-real` and say what it printed.",
    });
    if (created.ok !== true) throw new Error(`refused: ${JSON.stringify(created)}`);
    const { sessionId } = created.data as { sessionId: string };
    trace = () =>
      events(sessionId)
        .map((e) => (e.type === "session.error" ? `${e.type} ${JSON.stringify(e)}` : e.type))
        .join(", ");
    await client.request("session.subscribe", { sessionId });
    const asked = await until(
      () => events(sessionId).find((e) => e.type === "permission.requested"),
      "permission.requested",
    );
    log(`asked for ${asked.toolName}`);
    await client.request("permission.respond", { requestId: asked.requestId, decision: "deny" });
    await until(() => events(sessionId).some((e) => e.type === "turn.result"), "the first turn");

    step = "a neutralized /hello does not run";
    await client.request("session.send", { sessionId, text: "/hello" });
    await until(
      () => events(sessionId).filter((e) => e.type === "turn.result").length >= 2,
      "the /hello turn",
    );

    step = "no marker of the hostile project appears";
    const left = MARKERS.filter((name) => existsSync(markerPath(markers, name)));
    if (left.length > 0) throw new Error(`markers: ${left.join(", ")}`);
    log("no plugin, MCP server or /hello ran");

    step = "a saved always rule makes the preflight refuse";
    await client.request("session.close", { sessionId });
    client.close();
    await daemon.stop();
    await saveARule();
    if (savedRules().length === 0) throw new Error("answering always saved no rule");
    // A new daemon: the preflight's passes are cached for ten minutes.
    daemon = await start();
    ({ client, events } = await connect(daemon.url));
    const refused = await client.request("session.create", { cwd: project, runtime: "opencode" });
    const reason = (refused.error as { reason?: string } | undefined)?.reason;
    if (refused.ok !== false || reason !== "opencode_saved_rules") {
      throw new Error(`not refused for the saved rule: ${JSON.stringify(refused)}`);
    }
    log("refused: opencode_saved_rules");

    step = "once the saved rule is gone the preflight passes";
    for (const id of savedRules())
      opencode(["api", "DELETE", `/api/permission/saved/${id}`, "--standalone"]);
    if (savedRules().length > 0) throw new Error("the saved rule is still there");
    const passed = await client.request("session.create", { cwd: project, runtime: "opencode" });
    if (passed.ok !== true) throw new Error(`still refused: ${JSON.stringify(passed)}`);
    log("passes without the saved rule");
  } finally {
    client.close();
    await daemon.stop();
  }
}

let code = 1;
try {
  await run();
  assertNoClaudeCalls(guard);
  console.log("SMOKE OPENCODE REAL OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE OPENCODE REAL FAIL at step "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
  const seen = trace();
  if (seen) console.error(`  the session's events: ${seen}`);
  for (const line of daemonOpenCodeLines()) console.error(`  daemon: ${line}`);
} finally {
  if (exe && existsSync(project)) {
    for (const id of savedRules())
      opencode(["api", "DELETE", `/api/permission/saved/${id}`, "--standalone"]);
    // Every session of the scratch project is the smoke's (one is made even when session/new times
    // out). --standalone: the background service never sees Flightdeck's variables and would load
    // the hostile project's config to answer.
    const listed = opencode(["session", "list", "--standalone"]).stdout;
    for (const [id] of listed.matchAll(/ses_\w+/g))
      opencode(["session", "delete", "--standalone", id]);
  }
}
process.exit(code);
