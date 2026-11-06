#!/usr/bin/env bun
/**
 * OpenCode smoke (phase 39): a daemon with OpenCode turned on and the fake `opencode` first on its
 * PATH (apps/daemon/test/fake-opencode.ts). Over the socket: the host lists OpenCode; an OpenCode
 * session asks to run a command and the person allows it; the tool result and a turn with its cost
 * arrive; a text that starts with `/` reaches OpenCode with a zero-width space first; a waiting turn
 * is interrupted; the daemon restarts and the same session goes on with `session/resume`.
 * Nothing real is touched: the CLI, Claude and home guards are on, the real `opencode` is never run.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { HostInfoResult } from "@flightdeck/protocol";
import { startDaemon } from "../apps/daemon/src/main.ts";
import { installFakeOpenCode } from "../apps/daemon/test/fake-opencode.ts";
import { FrameClient } from "../apps/daemon/test/history-helpers.ts";
import { assertNoClaudeCalls, installClaudeGuard } from "./test/claude-guard.ts";
import { assertCliGuardActive, assertNoCliCalls, installCliGuard } from "./test/cli-guard.ts";
import { assertHomeGuard, installHomeGuard } from "./test/home-guard.ts";
import { scrubOpenCodeEnv } from "./test/opencode-env-guard.ts";
import { realTempDir } from "./test/temp-dir.ts";

scrubOpenCodeEnv(process.env);
const clis = installCliGuard();
const guard = installClaudeGuard();
const home = installHomeGuard();
assertCliGuardActive(clis);

const TOKEN = "smoke-opencode-token-0123456789abcdef";
const TIMEOUT_MS = 30_000;
const ZWSP = "​";

let step = "prepare";
const log = (msg: string) => console.log(`  · ${msg}`);
const quiet = { log: () => {}, error: () => {} };

async function until<T>(check: () => T | null | undefined | false, what: string): Promise<T> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await Bun.sleep(20);
  }
}

interface Event {
  type: string;
  requestId?: string;
  toolName?: string;
  subtype?: string;
  costUsd?: number;
  status?: string;
}

async function run() {
  const fake = installFakeOpenCode();
  const dir = realTempDir("flightdeck-smoke-opencode-");
  const root = join(dir, "root");
  const project = join(root, "project");
  mkdirSync(project, { recursive: true });
  const config = join(dir, "config.json");
  writeFileSync(
    config,
    JSON.stringify({
      port: 0,
      token: TOKEN,
      dataDir: join(dir, "data"),
      allowedRoots: [root],
      claude: { executablePath: join(dir, "no-claude") },
      opencode: { enabled: true },
    }),
  );
  // Only the daemon sees the fake: the smoke's own PATH keeps the guard's sentinel first.
  const env = { ...process.env, PATH: `${fake.dir}${delimiter}${process.env.PATH ?? ""}` };
  const start = () => startDaemon({ command: "start", config, runtime: "claude" }, env, quiet);

  let daemon = await start();
  let client = new FrameClient(daemon.url);
  const events = (sessionId: string) =>
    client.frames
      .filter((f) => f.type === "event" && f.sessionId === sessionId)
      .map((f) => f.event as Event);
  try {
    await client.request("hello", { token: TOKEN, client: "smoke-opencode" });

    step = "the host lists OpenCode as available";
    const info = await client.data<HostInfoResult>("host.info", {});
    const opencode = info?.runtimes?.find((r) => r.kind === "opencode");
    if (!opencode?.available) throw new Error(`OpenCode is not available: ${opencode?.reason}`);
    log(`OpenCode ${opencode.version} at ${opencode.path}`);

    step = "an OpenCode session asks to run a command";
    const created = await client.data<{ sessionId: string }>("session.create", {
      cwd: project,
      prompt: "run: echo hi",
      runtime: "opencode",
    });
    if (!created) throw new Error("session.create was refused");
    const { sessionId } = created;
    await client.request("session.subscribe", { sessionId });
    const asked = await until(
      () => events(sessionId).find((e) => e.type === "permission.requested"),
      "permission.requested",
    );
    if (asked.toolName !== "Bash") throw new Error(`the request is for ${asked.toolName}`);

    step = "the person allows it; the tool result and the turn with its cost arrive";
    const answer = await client.request("permission.respond", {
      requestId: asked.requestId,
      decision: "allow",
    });
    if (answer.ok !== true) throw new Error("the answer was refused");
    await until(() => events(sessionId).some((e) => e.type === "tool.result"), "tool.result");
    const turn = await until(
      () => events(sessionId).find((e) => e.type === "turn.result"),
      "turn.result",
    );
    if (turn.subtype !== "success" || typeof turn.costUsd !== "number") {
      throw new Error(`turn: ${JSON.stringify(turn)}`);
    }
    log(`turn ${turn.subtype}, cost ${turn.costUsd}`);

    step = "a text that starts with / reaches OpenCode with a zero-width space first";
    await client.request("session.send", { sessionId, text: "/compact now" });
    const slash = await until(
      () => fake.acp().find((r) => r.method === "session/prompt" && r.text?.includes("compact")),
      "the / prompt at the fake",
    );
    if (slash.text !== `${ZWSP}/compact now`) {
      throw new Error(`OpenCode got ${JSON.stringify(slash.text)}`);
    }
    await until(
      () => events(sessionId).filter((e) => e.type === "turn.result").length >= 2,
      "the turn of the / text",
    );
    log("the / text was neutralized");

    step = "a waiting turn is interrupted";
    await client.request("session.send", { sessionId, text: "please wait" });
    await until(
      () => fake.acp().some((r) => r.method === "session/prompt" && r.text === "please wait"),
      "the waiting prompt at the fake",
    );
    await client.request("session.interrupt", { sessionId });
    await until(() => fake.acp().some((r) => r.method === "session/cancel"), "session/cancel");
    await until(
      () => events(sessionId).filter((e) => e.type === "turn.result").length >= 3,
      "the interrupted turn",
    );
    log("interrupted");

    step = "the daemon restarts and the session goes on with session/resume";
    client.close();
    await daemon.stop();
    daemon = await start();
    client = new FrameClient(daemon.url);
    await client.request("hello", { token: TOKEN, client: "smoke-opencode" });
    await client.request("session.subscribe", { sessionId });
    const sent = await client.request("session.send", { sessionId, text: "hello again" });
    if (sent.ok !== true)
      throw new Error(`session.send after the restart: ${JSON.stringify(sent)}`);
    await until(() => fake.acp().some((r) => r.method === "session/resume"), "session/resume");
    await until(
      () => events(sessionId).some((e) => e.type === "turn.result"),
      "the turn after the restart",
    );
    log("resumed after the restart");
  } finally {
    client.close();
    await daemon.stop();
  }
}

let code = 1;
try {
  await run();
  assertNoCliCalls(clis);
  assertNoClaudeCalls(guard);
  assertHomeGuard(home);
  console.log("SMOKE OPENCODE OK");
  code = 0;
} catch (error) {
  console.error(
    `SMOKE OPENCODE FAIL at step "${step}": ${error instanceof Error ? error.message : String(error)}`,
  );
}
process.exit(code);
