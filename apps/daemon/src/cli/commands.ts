import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CardCliArgs } from "../board/index.ts";
import { loadConfig, userHome } from "../config.ts";
import type { CliResult, RemoteTarget } from "../daemon-client/index.ts";
import { type Logger, type OnProcessEvent, settled } from "../kernel/index.ts";
import type { PersonaCliArgs } from "../personas/index.ts";
import type { ResolveDeps } from "../remote-hosts/index.ts";
import { configPath } from "./config-path.ts";
import { type CliArgs, USAGE } from "./domain/args.ts";
import { exitWhenClosed } from "./domain/exit.ts";
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
  /** The process's own events, so the daemon's end is traced in its log (#3403); none when absent. */
  onProcessEvent?: OnProcessEvent;
  /** How long `hook session-start` tries to reach the receptor. */
  hookConnectTimeoutMs?: number;
  /** Where `flightdeckd channel` speaks MCP; stdio when absent. */
  channelTransport?: Transport;
  /** Where `flightdeckd mcp` speaks MCP; stdio when absent. */
  mcpTransport?: Transport;
  /** The folder `flightdeckd mcp` runs in; the process's when absent. */
  cwd?: string;
  /** What `--host` reads (the app's name index and the credential helper); this machine's own when absent. Injected in tests. */
  remote?: ResolveDeps;
  /** The platform `flightdeckd claude` launches claude on; the process's when absent. Injected in tests. */
  platform?: NodeJS.Platform;
  /** Whether `flightdeckd claude` runs as root (claude refuses bypass there); the process's when absent. Injected in tests. */
  root?: boolean;
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

/** The config of a command that asks the daemon: its token is read from the config file and from nowhere else. */
async function localConfig(args: CliArgs) {
  if (args.token !== undefined)
    throw new Error("the token of this command is read from the config file only: drop --token");
  try {
    return await loadConfig(configPath(args));
  } catch {
    // The parser's message quotes the text it could not read, and that text may be the token.
    throw new Error(
      "the config file cannot be read or is not valid: fix it, or start the daemon once to write it",
    );
  }
}

/** Prints what a command that asks the local daemon returned, and gives its exit code. */
const reported = (deps: CliDeps, result: CliResult, asJson = false): Promise<number> =>
  settled(() => {
    for (const line of result.out) deps.log.log(line);
    // A script reads the refusal of a command on another host as one JSON line with its stable reason (#3429).
    for (const line of result.err)
      deps.log.error(
        asJson && result.reason !== undefined
          ? JSON.stringify({ error: line, reason: result.reason })
          : `flightdeckd: ${line}`,
      );
    return result.code;
  });

/** What `--host` reads on this machine: the app's index and the credential helper beside the binary. */
async function remoteDeps(deps: CliDeps): Promise<ResolveDeps> {
  if (deps.remote) return deps.remote;
  const { boundedExec } = await import("../kernel/index.ts");
  const { HELPER_TIMEOUT_MS } = await import("../remote-hosts/index.ts");
  return {
    env: {
      platform: process.platform,
      home: userHome(deps.env, process.platform),
      ...(deps.env.APPDATA ? { appData: deps.env.APPDATA } : {}),
      ...(deps.env.ProgramFiles ? { programFiles: deps.env.ProgramFiles } : {}),
      ...(deps.env.LOCALAPPDATA ? { localAppData: deps.env.LOCALAPPDATA } : {}),
      ...(deps.env.XDG_CONFIG_HOME ? { xdgConfigHome: deps.env.XDG_CONFIG_HOME } : {}),
      execPath: process.execPath,
    },
    uid: process.getuid?.() ?? null,
    exec: boundedExec(HELPER_TIMEOUT_MS),
  };
}

/** Where `host`, `sessions`, `requests`, `send`, `approve` and `deny` ask: this machine's daemon, or the paired host `--host` names (#3429). */
async function asking(
  args: CliArgs,
  deps: CliDeps,
  run: (config: LocalConfig, remote?: RemoteTarget) => Promise<CliResult>,
): Promise<number> {
  if (args.host === undefined) return reported(deps, await run(await localConfig(args)), args.json);
  if (args.token !== undefined)
    throw new Error("the token of this command is read from the config file only: drop --token");
  if (args.config !== undefined)
    throw new Error(
      "--config names the config of this machine, which --host does not use: drop --config",
    );
  const { resolveHost } = await import("../remote-hosts/index.ts");
  const resolved = await resolveHost(args.host, await remoteDeps(deps));
  if (!resolved.ok) return reported(deps, resolved.result, args.json);
  // The config of this machine plays no part: the address and the token are the host's.
  return reported(deps, await run(NO_LOCAL_DAEMON, resolved.target), args.json);
}

type LocalConfig = { bind: string; port: number; token: string };
const NO_LOCAL_DAEMON: LocalConfig = { bind: "", port: 0, token: "" };

/** `approve` and `deny`: one answer to one open permission request. */
async function answered(decision: "allow" | "deny", args: CliArgs, deps: CliDeps): Promise<number> {
  const { runAnswerCli } = await import("../permissions/index.ts");
  return asking(args, deps, (config, remote) =>
    runAnswerCli(
      {
        decision,
        request: args.requestId ?? "",
        ...(args.answerMessage === undefined ? {} : { message: args.answerMessage }),
        ...(args.json ? { json: true } : {}),
      },
      config,
      remote ? { remote } : {},
    ),
  );
}

/** The MCP SDK's stdio transport, loaded only by the commands that speak MCP. */
const stdioTransport = async (): Promise<Transport> =>
  new (await import("@modelcontextprotocol/sdk/server/stdio.js")).StdioServerTransport();

/** What the person typed for `card`, as `runCardCli` takes it: what they left out stays out. */
function cardCliArgs(args: CliArgs): CardCliArgs {
  const typed: Record<string, unknown> = {
    project: args.project,
    id: args.cardId,
    title: args.cardTitle,
    description: args.description,
    workflow: args.workflow,
    column: args.column,
    position: args.position,
    force: args.force || undefined,
    confirm: args.confirm || undefined,
    squash: args.squash || undefined,
    message: args.answerMessage,
    estimate: args.estimate,
    validationNote: args.validationNote,
    specPath: args.specPath,
    blockedBy: args.blockedBy,
    text: args.text,
    language: args.language,
    json: args.json || undefined,
  };
  const present = Object.entries(typed).filter(([, value]) => value !== undefined);
  return { action: args.action, ...Object.fromEntries(present) } as CardCliArgs;
}

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
  help: async (_args, deps) =>
    settled(() => {
      deps.log.log(USAGE);
      return 0;
    }),
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
    const file = configPath({ ...args, config: deps.env.FLIGHTDECK_CONFIG });
    const configExisted = await Bun.file(file).exists();
    return runClaude({
      configExisted,
      args: args.claudeArgs ?? [],
      cwd: deps.cwd ?? process.cwd(),
      config: await loadConfig(file),
      env: deps.env,
      self: deps.selfCommand ?? daemonCommand(process.execPath, Bun.main),
      log: deps.log,
      timeoutMs: deps.hookConnectTimeoutMs ?? HOOK_CONNECT_TIMEOUT_MS,
      ...(deps.platform ? { platform: deps.platform } : {}),
      ...(deps.root === undefined ? {} : { root: deps.root }),
      ...(deps.exec ? { exec: deps.exec } : {}),
    });
  },
  askpass: async (args, deps) => {
    const { runAskpass } = await import("../ssh/index.ts");
    // ssh runs this with only the prompt, so the config comes from the environment.
    const file = configPath({ ...args, config: deps.env.FLIGHTDECK_CONFIG });
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
    const config = await localConfig(args);
    return reported(deps, await runCardCli(cardCliArgs(args), config));
  },
  persona: async (args, deps) => {
    const { runPersonaCli } = await import("../personas/index.ts");
    const config = await localConfig(args);
    return reported(
      deps,
      await runPersonaCli(
        {
          action: args.action as PersonaCliArgs["action"],
          ...(args.personaId === undefined ? {} : { id: args.personaId }),
          ...(args.personaName === undefined ? {} : { name: args.personaName }),
          ...(args.description === undefined ? {} : { description: args.description }),
          ...(args.body === undefined ? {} : { body: args.body }),
          ...(args.bodyFile === undefined ? {} : { bodyFile: args.bodyFile }),
          ...(args.model === undefined ? {} : { model: args.model }),
          ...(args.effort === undefined ? {} : { effort: args.effort }),
          ...(args.tools === undefined ? {} : { tools: args.tools }),
          ...(args.permissionMode === undefined
            ? {}
            : { permissionMode: args.permissionMode as PersonaCliArgs["permissionMode"] }),
          ...(args.icon === undefined ? {} : { icon: args.icon }),
          ...(args.confirm ? { confirm: true } : {}),
          ...(args.scope === undefined ? {} : { scope: args.scope }),
          ...(args.projectPath === undefined ? {} : { projectPath: args.projectPath }),
          ...(args.language === undefined ? {} : { language: args.language }),
          ...(args.json ? { json: true } : {}),
        },
        config,
      ),
      args.json,
    );
  },
  host: async (args, deps) => {
    const { runHostCli } = await import("../hosts/index.ts");
    return asking(args, deps, (config, remote) =>
      runHostCli(args.json ? { json: true } : {}, config, remote ? { remote } : {}),
    );
  },
  sessions: async (args, deps) => {
    const { runSessionsCli } = await import("../sessions/index.ts");
    return asking(args, deps, (config, remote) =>
      runSessionsCli(args.json ? { json: true } : {}, config, remote ? { remote } : {}),
    );
  },
  requests: async (args, deps) => {
    const { runRequestsCli } = await import("../permissions/index.ts");
    return asking(args, deps, (config, remote) =>
      runRequestsCli(
        {
          ...(args.session === undefined ? {} : { session: args.session }),
          ...(args.json ? { json: true } : {}),
        },
        config,
        remote ? { remote } : {},
      ),
    );
  },
  send: async (args, deps) => {
    const { runSendCli } = await import("../sessions/index.ts");
    return asking(args, deps, (config, remote) =>
      runSendCli(
        {
          session: args.sendTo ?? "",
          text: args.text ?? "",
          ...(args.json ? { json: true } : {}),
        },
        config,
        remote ? { remote } : {},
      ),
    );
  },
  approve: async (args, deps) => answered("allow", args, deps),
  deny: async (args, deps) => answered("deny", args, deps),
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
  approvers: async (args, deps) => (await import("./approvers.ts")).runApprovers(args, deps),
  doctor: async (args, deps) => (await import("./setup.ts")).runDoctorCommand(args, deps),
  setup: done(async (args, deps) => (await import("./setup.ts")).runSetupCommand(args, deps)),
  pair: done(async (args, deps) => (await import("./setup.ts")).runPair(args, deps)),
  service: done(async (args, deps) => (await import("./host.ts")).runService(args, deps)),
};
