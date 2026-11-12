import { resolve } from "node:path";
import { PROTOCOL_VERSION } from "@flightdeck/protocol";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { runActionCli, runSnippetCli } from "../actions/index.ts";
import { runCardCli } from "../board/index.ts";
import { runClaude, sendSessionStart, startChannel } from "../central/index.ts";
import { defaultConfigPath, expandHome, loadConfig } from "../config.ts";
import { runStatusline } from "../costs/index.ts";
import type { Logger } from "../logger.ts";
import { daemonUrl, identityOf, startMcp } from "../mcp.ts";
import { runMessageCli } from "../messaging/index.ts";
import { daemonCommand } from "../service.ts";
import { settled } from "../settled.ts";
import { runAskpass } from "../ssh/index.ts";
import { DAEMON_VERSION } from "../version.ts";
import { type CliArgs, configPath } from "./args.ts";
import { runHooks, runTelemetry } from "./claude-settings.ts";
import { runReindex } from "./history.ts";
import { runService, runUpdateCommand } from "./host.ts";
import { type MaintenanceCommandDeps, runBackup, runPrune, runRestore } from "./maintenance.ts";
import { runDoctorCommand, runPair, runSetupCommand, type SetupCommandDeps } from "./setup.ts";

/**
 * The commands of `flightdeckd` that are not the daemon (issue #1593): what each prints and does.
 * main.ts runs one of these, or starts the daemon.
 */

/** `hook session-start` gives up on the receptor after this long (the hook's own limit is 5 s). */
export const HOOK_CONNECT_TIMEOUT_MS = 1_000;

export interface CliDeps extends SetupCommandDeps, MaintenanceCommandDeps {
  log: Logger;
  exit(code: number): void;
  onSignal(signal: "SIGINT" | "SIGTERM", handler: () => Promise<void>): void;
  /** How long `hook session-start` tries to reach the receptor. */
  hookConnectTimeoutMs?: number;
  /** Where `flightdeckd channel` speaks MCP; stdio when absent. */
  channelTransport?: Transport;
  /** Where `flightdeckd mcp` speaks MCP; stdio when absent. */
  mcpTransport?: Transport;
  /** The folder `flightdeckd mcp` runs in; the process's when absent. */
  cwd?: string;
  /** The platform `flightdeckd claude` launches claude on; the process's when absent. Injected in tests. */
  platform?: NodeJS.Platform;
}

/** A command that is not the daemon: what it prints and does, and the exit code (null: it stays open). */
type CommandRun = (args: CliArgs, deps: CliDeps) => Promise<number | null>;

/** Runs a one-shot step and exits 0. */
const done =
  (step: (args: CliArgs, deps: CliDeps) => Promise<unknown>): CommandRun =>
  async (args, deps) => {
    await step(args, deps);
    return 0;
  };

/** Prints what a client command returned, as JSON, and exits 0. */
const printed = (deps: CliDeps, result: unknown): Promise<number> =>
  settled(() => {
    deps.log.log(JSON.stringify(result, null, 2));
    return 0;
  });

export const COMMANDS: Partial<Record<CliArgs["command"], CommandRun>> = {
  backup: done(runBackup),
  restore: done(runRestore),
  update: (args, deps) => runUpdateCommand(args, deps),
  db: done(runPrune),
  version: (_args, deps) =>
    settled(() => {
      deps.log.log(`flightdeckd ${DAEMON_VERSION} (protocolo ${PROTOCOL_VERSION})`);
      return 0;
    }),
  hook: async (args, deps) => {
    await sendSessionStart({
      url: args.url ?? "",
      token: args.token ?? "",
      input: await new Response(deps.stdin ?? Bun.stdin.stream()).text(),
      env: deps.env,
      timeoutMs: deps.hookConnectTimeoutMs ?? HOOK_CONNECT_TIMEOUT_MS,
    });
    return 0;
  },
  claude: async (args, deps) => {
    // Its own arguments all go to claude, so the config comes from the environment.
    const file = resolve(expandHome(deps.env.FLIGHTDECK_CONFIG ?? defaultConfigPath()));
    return runClaude({
      args: args.claudeArgs ?? [],
      cwd: deps.cwd ?? process.cwd(),
      config: await loadConfig(file),
      env: deps.env,
      self: deps.selfCommand ?? daemonCommand(process.execPath, Bun.main),
      log: deps.log,
      timeoutMs: deps.hookConnectTimeoutMs ?? HOOK_CONNECT_TIMEOUT_MS,
      ...(deps.platform ? { platform: deps.platform } : {}),
      ...(deps.exec ? { exec: deps.exec } : {}),
    });
  },
  askpass: async (args, deps) => {
    // ssh runs this with only the prompt, so the config comes from the environment.
    const file = resolve(expandHome(deps.env.FLIGHTDECK_CONFIG ?? defaultConfigPath()));
    const secret = await runAskpass({
      configFile: file,
      ticket: deps.env.FLIGHTDECK_ASKPASS_TICKET,
      prompt: args.askpassPrompt ?? "",
    });
    deps.log.log(secret);
    return 0;
  },
  channel: async (args, deps) => {
    const channel = await startChannel({
      launchId: args.launch ?? "",
      url: args.url ?? "",
      token: args.token ?? "",
      transport: deps.channelTransport ?? new StdioServerTransport(),
    }).catch((error: Error) => {
      throw new Error(`could not open the Flightdeck channel: ${error.message}`);
    });
    void channel.closed.then(() => deps.exit(0));
    return null;
  },
  statusline: async (args, deps) => {
    // Never creates the config: a statusline runs where there may be no daemon at all.
    const line = await runStatusline({
      configFile: configPath(args),
      stdin: deps.stdin ?? Bun.stdin.stream(),
    });
    deps.log.log(line);
    return 0;
  },
  mcp: async (args, deps) => {
    const config = await loadConfig(configPath(args));
    const mcp = await startMcp({
      url: daemonUrl(config),
      token: config.token,
      transport: deps.mcpTransport ?? new StdioServerTransport(),
      cwd: deps.cwd ?? process.cwd(),
      identity: identityOf(deps.env),
    });
    void mcp.closed.then(() => deps.exit(0));
    return null;
  },
  message: async (args, deps) => {
    const config = await loadConfig(configPath(args));
    return printed(
      deps,
      await runMessageCli(
        {
          action: args.action as "list" | "send" | "idle" | "read" | "team",
          to: args.to,
          text: args.text,
          session: args.session,
          last: args.last,
          team: args.team,
        },
        config,
        identityOf(deps.env),
      ),
    );
  },
  card: async (args, deps) => {
    // The daemon's token is read from the config file and from nowhere else.
    if (args.token !== undefined)
      throw new Error("the token of this command is read from the config file only: drop --token");
    const config = await loadConfig(configPath(args));
    const result = await runCardCli(
      {
        action: args.action as "list" | "show" | "new" | "start",
        ...(args.project === undefined ? {} : { project: args.project }),
        ...(args.cardId === undefined ? {} : { id: args.cardId }),
        ...(args.cardTitle === undefined ? {} : { title: args.cardTitle }),
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.workflow === undefined ? {} : { workflow: args.workflow }),
        ...(args.json ? { json: true } : {}),
      },
      config,
    );
    return settled(() => {
      for (const line of result.out) deps.log.log(line);
      for (const line of result.err) deps.log.error(`flightdeckd: ${line}`);
      return result.code;
    });
  },
  action: async (args, deps) => {
    const config = await loadConfig(configPath(args));
    return printed(
      deps,
      await runActionCli(
        {
          action: args.action as "list" | "run",
          project: args.project,
          name: args.actionName,
          params: args.params,
        },
        config,
      ),
    );
  },
  snippet: async (args, deps) => {
    const config = await loadConfig(configPath(args));
    return printed(
      deps,
      await runSnippetCli(
        {
          action: args.action as "list" | "get",
          name: args.snippetName,
          projectPath: args.projectPath,
          query: args.query,
        },
        config,
      ),
    );
  },
  hooks: done(runHooks),
  telemetry: done(runTelemetry),
  history: done(runReindex),
  doctor: (args, deps) => runDoctorCommand(args, deps),
  setup: done(runSetupCommand),
  pair: done(runPair),
  service: done(runService),
};
