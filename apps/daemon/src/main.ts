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

export interface Logger {
  log(message: string): void;
  error(message: string): void;
}

export interface Daemon {
  url: string;
  runtime: AgentRuntime;
  stop(): Promise<void>;
}

async function createRuntime(kind: RuntimeKind, claudePath?: string): Promise<AgentRuntime> {
  if (kind === "fake") return new FakeRuntime();
  const { ClaudeSdkRuntime } = await import("./runtime/claude-sdk-runtime.ts");
  return new ClaudeSdkRuntime(claudePath ? { claudePath } : {});
}

/** Loads the config, opens the store and starts serving. The token is never logged. */
export async function startDaemon(
  args: CliArgs,
  env: Record<string, string | undefined>,
  logger: Logger,
): Promise<Daemon> {
  const config = loadConfig(args.config);
  const runtimeKind = args.runtime ?? config.runtime;
  const store = new EventStore(join(config.dataDir, "flightdeck.db"));
  const runtime = await createRuntime(runtimeKind, config.claudePath);
  const manager = new SessionManager({
    store,
    runtime,
    allowedRoots: config.allowedRoots,
    defaultPermissionMode: config.defaultPermissionMode,
    allowApiKey: config.allowApiKey,
    baseEnv: env,
  });
  const server = startServer({
    manager,
    hostName: config.hostName,
    bind: config.bind,
    port: config.port,
    token: config.token,
    allowedRoots: config.allowedRoots,
  });

  logger.log(`flightdeckd ${DAEMON_VERSION} listening on ${server.url} (runtime=${runtimeKind})`);
  if (config.allowedRoots.length === 0) {
    logger.error("aviso: allowedRoots está vazio; nenhuma sessão poderá ser criada");
  }

  let stopped: Promise<void> | null = null;
  return {
    url: server.url,
    runtime,
    stop: () => {
      stopped ??= (async () => {
        await manager.shutdown();
        await server.stop();
        store.close();
      })();
      return stopped;
    },
  };
}

export interface CliDeps {
  env: Record<string, string | undefined>;
  log: Logger;
  exit(code: number): void;
  onSignal(signal: "SIGINT" | "SIGTERM", handler: () => Promise<void>): void;
}

/** CLI entry: starts the daemon and wires SIGINT/SIGTERM to a clean stop. */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<Daemon | null> {
  try {
    const daemon = await startDaemon(parseArgs(argv), deps.env, deps.log);
    const stop = async () => {
      await daemon.stop();
      deps.exit(0);
    };
    deps.onSignal("SIGINT", stop);
    deps.onSignal("SIGTERM", stop);
    return daemon;
  } catch (error) {
    deps.log.error(`flightdeckd: ${error instanceof Error ? error.message : String(error)}`);
    deps.exit(1);
    return null;
  }
}
