/**
 * Issue #3537: `flightdeckd ssh list|import preview|hostkey check|test`, the read side of a host's ssh
 * destinations. `list` and `import preview` read the daemon's own list, or `~/.ssh/config`. `hostkey
 * check` and `test` make the daemon connect to the destination, but never write: no key is pinned, and
 * no vault key leaves this process (the request holds the destination's id only). Exit codes: 0 done,
 * 1 refused or a check that did not pass, 2 no daemon.
 */
import {
  type CliResult,
  failure,
  json,
  type RemoteTarget,
  runOnLocalDaemon,
  said,
} from "../daemon-client/index.ts";
import { hostKeyLine, testLine } from "./domain/ssh-connect-view.ts";
import { importLines, targetLines } from "./domain/ssh-read-view.ts";
import { resolveSshTarget } from "./domain/target-ref.ts";

const DEFAULT_TIMEOUT_MS = 15_000;
/** A connecting verb waits for ssh-keyscan (5 s) and a ConnectTimeout (10 s) for each hop of a jump chain. */
const CONNECT_TIMEOUT_MS = 60_000;

export interface SshCliArgs {
  action: "list" | "import-preview" | "hostkey-check" | "test";
  /** The destination, its name or its id, for `hostkey-check` and `test`. */
  target?: string;
  json?: boolean;
}

export function runSshCli(
  args: SshCliArgs,
  config: { bind: string; port: number; token: string },
  options: { timeoutMs?: number; remote?: RemoteTarget } = {},
): Promise<CliResult> {
  return runOnLocalDaemon({
    config,
    ...(options.remote ? { remote: options.remote } : {}),
    clientName: "flightdeck-ssh",
    timeoutMs:
      options.timeoutMs ??
      (args.action === "hostkey-check" || args.action === "test"
        ? CONNECT_TIMEOUT_MS
        : DEFAULT_TIMEOUT_MS),
    perform: async (daemon) => {
      if (args.action === "hostkey-check" || args.action === "test") {
        const { targets } = await daemon.call("ssh.list", {});
        const found = resolveSshTarget(targets, args.target ?? "");
        if ("problem" in found) return failure(1, found.problem);
        const { id, name, auth } = found.target;
        if (args.action === "hostkey-check") {
          const check = await daemon.call("ssh.hostkey.check", { targetId: id });
          const shown = hostKeyLine(name, check);
          const base = args.json ? json(check) : said(shown.line);
          return { ...base, code: shown.code, ...(shown.reason ? { reason: shown.reason } : {}) };
        }
        // The terminal never sends a key: a vault key lives in the app, so the test is the app's to run.
        if (auth === "vault-key") {
          return failure(
            1,
            `${name} uses a vault key, which a terminal never sends: test it from the app`,
            "ssh_key_missing",
          );
        }
        const result = await daemon.call("ssh.test", { targetId: id });
        const shown = testLine(name, result);
        const base = args.json ? json(result) : said(shown.line);
        return { ...base, code: shown.code, ...(result.reason ? { reason: result.reason } : {}) };
      }
      if (args.action === "list") {
        const result = await daemon.call("ssh.list", {});
        return args.json ? json(result) : said(...targetLines(result.targets));
      }
      const result = await daemon.call("ssh.import.preview", {});
      return args.json ? json(result) : said(...importLines(result.entries));
    },
  });
}
