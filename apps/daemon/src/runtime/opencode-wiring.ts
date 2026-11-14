/**
 * OpenCode on this host as the daemon builds it (phase 39, issue #1593): discovery, the doctor's
 * row, the preflight, the runtime and the model list, or the fake one of the demo.
 */
import { join } from "node:path";
import type { Config, RuntimeKind } from "../config.ts";
import { buildChildEnv } from "../kernel/index.ts";
import type { FlightdeckMcpServer } from "./domain/flightdeck-mcp.ts";
import { VERIFIED_OPENCODE_VERSION } from "./domain/opencode-config.ts";
import { FakeRuntime } from "./fake-runtime.ts";
import {
  discoverOpenCode,
  fileExists,
  fileStamp,
  type OpenCodeInfo,
} from "./opencode-discovery.ts";
import { REAL_KILL_DEPS, treeKiller } from "./opencode-kill.ts";
import { OpenCodePreflight } from "./opencode-preflight.ts";
import { OpenCodeModels, runCommand } from "./opencode-process.ts";
import { OpenCodeRuntime } from "./opencode-runtime.ts";
import { scanOpenCodeScope } from "./opencode-scope.ts";
import { startPrivateServer } from "./opencode-serve.ts";
import { OPENCODE_LEDGER_FILE, ProcessLedger, procSource } from "./process-ledger.ts";
import type { AgentRuntime } from "./types.ts";

/** Phase 39: what the host offers of OpenCode: whether it runs here, its runtime and its models. */
export interface CreatedOpenCode {
  info: OpenCodeInfo;
  runtime?: AgentRuntime;
  models?: () => Promise<Array<{ id: string; name: string }>>;
}

/** Phase 39: the fake host's OpenCode, for the demo and the journeys. */
function fakeOpenCode(): CreatedOpenCode {
  const models = [
    "anthropic/claude-sonnet-5-5",
    "openai/gpt-6.1-sol",
    "opencode/crouton-alpha-free",
  ];
  return {
    info: { available: true, path: "fake", version: VERIFIED_OPENCODE_VERSION, verified: true },
    runtime: new FakeRuntime(),
    models: () => Promise.resolve(models.map((id) => ({ id, name: id }))),
  };
}

/** Phase 39: OpenCode as discovery finds it on this host (it runs the binary: only when turned on). */
function discoverHost(config: Config, childEnv: Record<string, string>): Promise<OpenCodeInfo> {
  return discoverOpenCode(config.opencode, {
    env: childEnv,
    platform: process.platform,
    dataDir: config.dataDir,
    which: (bin) => Bun.which(bin, { PATH: childEnv.PATH ?? "" }),
    exists: fileExists,
    run: runCommand,
    scan: () => scanOpenCodeScope({ env: childEnv }),
    statFile: fileStamp,
  });
}

export interface OpenCodeState {
  enabled: boolean;
  /** The executable on PATH, looked up without running it. */
  found: string | null;
  /** What discovery said, when OpenCode is turned on. */
  info: OpenCodeInfo | null;
  platform: NodeJS.Platform;
}

/** Phase 39: the doctor's OpenCode row: looked up without running it, discovered only when on. */
export async function openCodeState(
  config: Config,
  env: Record<string, string | undefined>,
  known?: OpenCodeInfo,
): Promise<OpenCodeState> {
  const childEnv = buildChildEnv(env, config.allowApiKey);
  const enabled = config.opencode.enabled;
  return {
    enabled,
    found: Bun.which("opencode", { PATH: childEnv.PATH ?? "" }),
    info: enabled ? (known ?? (await discoverHost(config, childEnv))) : null,
    platform: process.platform,
  };
}

/**
 * Phase 39: finds and checks OpenCode when the host turned it on (it runs the binary), then builds
 * its preflight, its runtime and its model list.
 */
export async function createOpenCode(
  config: Config,
  kind: RuntimeKind,
  env: Record<string, string | undefined>,
  mcpServer: FlightdeckMcpServer,
  /** Why a preflight failed (the route and its exit code). */
  log: (message: string) => void,
): Promise<CreatedOpenCode> {
  // The demo and the journeys show the picker with a fake OpenCode, which runs nothing.
  if (kind === "fake") return fakeOpenCode();
  // A daemon that was killed leaves the commands its OpenCode sessions ran: reaped first, even
  // when OpenCode is off now (issue #250).
  const ledger = new ProcessLedger({
    file: join(config.dataDir, OPENCODE_LEDGER_FILE),
    proc: procSource(),
    killGroup: REAL_KILL_DEPS.killGroup,
  });
  const left = await ledger.reap();
  if (left.reaped.length > 0) {
    log(`OpenCode: ${left.reaped.length} process group(s) left by an earlier daemon were ended`);
  }
  if (!config.opencode.enabled) return { info: { available: false, reason: "opencode_disabled" } };
  const childEnv = buildChildEnv(env, config.allowApiKey);
  const scan = () => scanOpenCodeScope({ env: childEnv });
  const info = await discoverHost(config, childEnv);
  const { path, version } = info;
  if (!info.available || !path || !version) return { info };
  const preflight = new OpenCodePreflight({
    path,
    version,
    env: childEnv,
    // One private server per preflight, in the process groups the ledger knows (issue #243).
    serve: (opts) => startPrivateServer({ path, ledger, ...opts }),
    scan,
    log,
    // An executable discovery could not stamp is never trusted: the preflight refuses opencode_changed.
    exe: { fingerprint: info.fingerprint ?? "", current: () => fileStamp(path) },
  });
  const runtime = new OpenCodeRuntime({
    path,
    version,
    preflight,
    scan,
    kill: treeKiller(process.platform, REAL_KILL_DEPS),
    mcpServer,
    ledger,
  });
  const models = new OpenCodeModels({
    path,
    env: childEnv,
    dataDir: config.dataDir,
    run: runCommand,
    scan,
  });
  return { info, runtime, models: () => models.list() };
}
