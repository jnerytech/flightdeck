/**
 * Issue #3734: `flightdeckd bg list|start|stop|respawn|message`, the background sessions (`claude --bg`) of a host
 * from a shell, over the daemon's `bg.*` requests. `list` changes nothing; the four others start, end, replace or
 * write into a session, so they set `note.wrote` and wait longer than the daemon's own 20 s for `claude`. Exit
 * codes: 0 done, 1 refused, 2 no daemon (or no answer: the command may or may not have run).
 */
import {
  type CliResult,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
  shown,
} from "../daemon-client/index.ts";
import { bgDoneLine, bgJson, bgLines } from "./domain/bg-cli-view.ts";

export type BgCliArgs =
  | { action: "list"; json?: boolean }
  | {
      action: "start";
      cwd?: string;
      prompt?: string;
      card?: string;
      name?: string;
      persona?: string;
      json?: boolean;
    }
  | { action: "stop" | "respawn"; id: string; json?: boolean }
  | { action: "message"; id: string; text: string; json?: boolean };

const READ_TIMEOUT_MS = 15_000;
/** The daemon waits up to 20 s for `claude`; a shorter wait here would report a command that worked as lost. */
const WRITE_TIMEOUT_MS = 60_000;

const UNSURE =
  "; the command may or may not have run on the host: run `flightdeckd bg list` and look before you run it again";

export function runBgCli(
  args: BgCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-bg",
    timeoutMs: options.timeoutMs ?? (args.action === "list" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS),
    unsure: UNSURE,
    perform: async (daemon, note) => {
      if (args.action === "list") {
        const list = await daemon.call("bg.list", {});
        return shown(args.json, bgJson(list), () => bgLines(list));
      }
      note.wrote = true;
      if (args.action === "start") {
        const { id } = await daemon.call("bg.start", {
          ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
          ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
          ...(args.card === undefined ? {} : { cardId: args.card }),
          ...(args.name === undefined ? {} : { name: args.name }),
          ...(args.persona === undefined ? {} : { persona: args.persona }),
        });
        return args.json ? json({ id }) : said(bgDoneLine("start", id));
      }
      const list =
        args.action === "message"
          ? await daemon.call("bg.message", { id: args.id, text: args.text })
          : await daemon.call(args.action === "stop" ? "bg.stop" : "bg.respawn", { id: args.id });
      return args.json ? json(bgJson(list)) : said(bgDoneLine(args.action, args.id));
    },
  });
}
