#!/usr/bin/env bun
import { join } from "node:path";
import { loadConfig, RuntimeKind } from "./config.ts";
import { FakeRuntime } from "./runtime/fake-runtime.ts";
import type { AgentRuntime } from "./runtime/types.ts";
import { DAEMON_VERSION, startServer } from "./server.ts";
import { SessionManager } from "./sessions/session-manager.ts";
import { EventStore } from "./store/event-store.ts";

export interface CliArgs {
  command: "start";
  config?: string;
  runtime?: RuntimeKind;
}

const USAGE = "uso: flightdeckd [start] [--config <arquivo>] [--runtime fake|claude]";

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { command: "start" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const [flag, inline] = arg.startsWith("--") ? arg.split("=", 2) : [arg, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || v.startsWith("--"))
        throw new Error(`${flag} precisa de um valor\n${USAGE}`);
      return v;
    };
    switch (flag) {
      case "start":
        break;
      case "--config":
        args.config = value();
        break;
      case "--runtime":
        args.runtime = RuntimeKind.parse(value());
        break;
      default:
        throw new Error(`argumento desconhecido: ${arg}\n${USAGE}`);
    }
  }
  return args;
}

async function createRuntime(kind: RuntimeKind, claudePath?: string): Promise<AgentRuntime> {
  if (kind === "fake") return new FakeRuntime();
  const { ClaudeSdkRuntime } = await import("./runtime/claude-sdk-runtime.ts");
  return new ClaudeSdkRuntime(claudePath ? { claudePath } : {});
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args.config);
  const runtimeKind = args.runtime ?? config.runtime;
  const store = new EventStore(join(config.dataDir, "flightdeck.db"));
  const manager = new SessionManager({
    store,
    runtime: await createRuntime(runtimeKind, config.claudePath),
    allowedRoots: config.allowedRoots,
    defaultPermissionMode: config.defaultPermissionMode,
    allowApiKey: config.allowApiKey,
    baseEnv: process.env,
  });
  const server = startServer({
    manager,
    hostName: config.hostName,
    bind: config.bind,
    port: config.port,
    token: config.token,
    allowedRoots: config.allowedRoots,
  });

  console.log(`flightdeckd ${DAEMON_VERSION} listening on ${server.url} (runtime=${runtimeKind})`);
  if (config.allowedRoots.length === 0) {
    console.warn("aviso: allowedRoots está vazio; nenhuma sessão poderá ser criada");
  }

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await manager.shutdown();
    await server.stop();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`flightdeckd: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
