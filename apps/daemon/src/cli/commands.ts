import { resolve } from "node:path";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { defaultConfigPath, expandHome, loadConfig } from "../config.ts";
import { type Logger, settled } from "../kernel/index.ts";
import { type CliArgs, configPath } from "./args.ts";
import { exitWhenClosed } from "./exit.ts";
import type { MaintenanceCommandDeps } from "./maintenance.ts";
import type { SetupCommandDeps } from "./setup.ts";

/**
 * The commands of `flightdeckd` that are not the daemon (issue #1593): what each prints and does.
 * `run.ts` runs one of these, or leaves the daemon to main.ts. A command loads its own modules when
 * it runs (#1692): `statusline` runs on every redraw of Claude Code's status line and must not pay for
 * the daemon, the MCP SDK or the other commands.
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

/** The MCP SDK's stdio transport, loaded only by the commands that speak MCP. */
const stdioTransport = async (): Promise<Transport> =>
  new (await import("@modelcontextprotocol/sdk/server/stdio.js")).StdioServerTransport();

export const COMMANDS: Partial<Record<CliArgs["command"], CommandRun>> = {
  backup: done(async (args, deps) => (await import("./maintenance.ts")).runBackup(args, deps)),
  restore: done(async (args, deps) => (await import("./maintenance.ts")).runRestore(args, deps)),
  update: async (args, deps) => (await import("./host.ts")).runUpdateCommand(args, deps),
  db: done(async (args, deps) => (await import("./maintenance.ts")).runPrune(args, deps)),
  version: async (_args, deps) => {
    const { PROTOCOL_VERSION } = await import("@flightdeck/protocol");
    const { DAEMON_VERSION } = await import("../kernel/index.ts");
    return settled(() => {
      deps.log.log(`flightdeckd ${DAEMON_VERSION} (protocolo ${PROTOCOL_VERSION})`);
      return 0;
    });
  },
  hook: async (args, deps) => {
    const { sendSessionStart } = await import("../central/index.ts");
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
    const { runClaude } = await import("../central/index.ts");
    const { daemonCommand } = await import("../service/index.ts");
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
    const { runAskpass } = await import("../ssh/index.ts");
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
    const { startChannel } = await import("../central/index.ts");
    const channel = await startChannel({
      launchId: args.launch ?? "",
      url: args.url ?? "",
      token: args.token ?? "",
      transport: deps.channelTransport ?? (await stdioTransport()),
    }).catch((error: Error) => {
      throw new Error(`could not open the Flightdeck channel: ${error.message}`);
    });
    void exitWhenClosed(channel.closed, deps);
    return null;
  },
  statusline: async (args, deps) => {
    const { runStatusline } = await import("../costs/index.ts");
    // Never creates the config: a statusline runs where there may be no daemon at all.
    const line = await runStatusline({
      configFile: configPath(args),
      stdin: deps.stdin ?? Bun.stdin.stream(),
    });
    deps.log.log(line);
    return 0;
  },
  mcp: async (args, deps) => {
    const { daemonUrl } = await import("../daemon-client/index.ts");
    const { identityOf, startMcp } = await import("../mcp/index.ts");
    const config = await loadConfig(configPath(args));
    const mcp = await startMcp({
      url: daemonUrl(config),
      token: config.token,
      transport: deps.mcpTransport ?? (await stdioTransport()),
      cwd: deps.cwd ?? process.cwd(),
      identity: identityOf(deps.env),
    });
    void exitWhenClosed(mcp.closed, deps);
    return null;
  },
  message: async (args, deps) => {
    const { identityOf } = await import("../mcp/index.ts");
    const { runMessageCli } = await import("../messaging/index.ts");
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
    const { runCardCli } = await import("../board/index.ts");
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
    const { runActionCli } = await import("../actions/index.ts");
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
    const { runSnippetCli } = await import("../actions/index.ts");
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
  hooks: done(async (args, deps) => (await import("./claude-settings.ts")).runHooks(args, deps)),
  telemetry: done(async (args, deps) =>
    (await import("./claude-settings.ts")).runTelemetry(args, deps),
  ),
  history: done(async (args, deps) => (await import("./history.ts")).runReindex(args, deps)),
  doctor: async (args, deps) => (await import("./setup.ts")).runDoctorCommand(args, deps),
  setup: done(async (args, deps) => (await import("./setup.ts")).runSetupCommand(args, deps)),
  pair: done(async (args, deps) => (await import("./setup.ts")).runPair(args, deps)),
  service: done(async (args, deps) => (await import("./host.ts")).runService(args, deps)),
};
