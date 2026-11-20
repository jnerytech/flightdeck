/**
 * Issue #3538: `flightdeckd terminal list|open|open-session|close|settings`, a host's terminals. `list`
 * reads the daemon's own list. The rest are the app's own requests: `open` and `open-session` start a
 * shell (or Claude Code) in a PTY that outlives this command, `close` detaches it or ends its process,
 * and `settings` turns the host's terminals on or off. A terminal's output and keyboard stay the app's view
 * (`attach`, `write`, `resize`, `ack` and `detach` are no verb). Exit codes: 0 done, 1 refused, 2 no
 * daemon (or no answer: a terminal may or may not have changed).
 */
import {
  type CliResult,
  failure,
  json,
  type RemoteTarget,
  resolveSession,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import { terminalLines } from "./domain/terminal-read-view.ts";
import { closedLine, openedLine, settingsLine } from "./domain/terminal-write-view.ts";

const DEFAULT_TIMEOUT_MS = 15_000;

const UNSURE =
  "; a terminal may or may not have changed: run terminal list before you run it again";

const ENABLE_CONFIRM =
  "turning the terminals on gives whoever reaches this daemon a full shell on the host: pass --confirm";

type Size = { cols: number; rows: number };

export type TerminalCliArgs = { json?: boolean } & (
  | { action: "list" }
  | ({
      action: "open";
      cwd: string;
      /** The program and its arguments, never run through a shell; the host's shell when absent. */
      command?: string[];
      /** Claude Code in the folder instead of a shell: the session to resume and the persona, when given. */
      claude?: { resume?: string; persona?: string };
    } & Size)
  | ({ action: "open-session"; session: string } & Size)
  | { action: "close"; terminalId: string; kill: boolean }
  | { action: "settings"; enabled: boolean; confirm?: boolean }
);

export function runTerminalCli(
  args: TerminalCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  // The daemon asks for `confirm` too, but the person reads this before anything is sent.
  if (args.action === "settings" && args.enabled && args.confirm !== true)
    return Promise.resolve(failure(1, ENABLE_CONFIRM, "terminal_enable_confirm"));
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-terminal",
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    unsure: UNSURE,
    perform: async (daemon, note) => {
      if (args.action === "list") {
        const result = await daemon.call("terminal.list", {});
        return args.json ? json(result) : said(...terminalLines(result.terminals));
      }
      if (args.action === "open") {
        note.wrote = true;
        const { cwd, cols, rows } = args;
        const opened = await daemon.call("terminal.open", {
          cwd,
          cols,
          rows,
          ...(args.command ? { command: args.command } : {}),
          ...(args.claude ? { claude: args.claude } : {}),
        });
        return args.json ? json(opened) : said(openedLine(opened));
      }
      if (args.action === "open-session") {
        const { sessions } = await daemon.call("session.list", {});
        const ref = resolveSession(sessions, args.session);
        if ("refusal" in ref) return ref.refusal;
        note.wrote = true;
        const opened = await daemon.call("terminal.openSession", {
          session: ref.id,
          cols: args.cols,
          rows: args.rows,
        });
        return args.json ? json(opened) : said(openedLine(opened));
      }
      if (args.action === "close") {
        note.wrote = true;
        await daemon.call("terminal.close", { terminalId: args.terminalId, kill: args.kill });
        return args.json
          ? json({ terminalId: args.terminalId, kill: args.kill, closed: true })
          : said(closedLine(args.terminalId, args.kill));
      }
      note.wrote = true;
      const settings = await daemon.call("terminal.settings", {
        enabled: args.enabled,
        ...(args.enabled ? { confirm: true as const } : {}),
      });
      return args.json ? json(settings) : said(settingsLine(settings));
    },
  });
}
