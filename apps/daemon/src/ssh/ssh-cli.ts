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
import {
  confirmDecision,
  hostKeyForgottenLine,
  hostKeyLine,
  hostKeyPinnedLine,
  testLine,
} from "./domain/ssh-connect-view.ts";
import {
  importLines,
  importResultLines,
  removedLine,
  targetLines,
} from "./domain/ssh-read-view.ts";
import {
  addedLine,
  addPayload,
  editPayload,
  type SshSaveFields,
  updatedLine,
} from "./domain/ssh-save-view.ts";
import { resolveSshTarget } from "./domain/target-ref.ts";

const DEFAULT_TIMEOUT_MS = 15_000;
/** A connecting verb waits for ssh-keyscan (5 s) and a ConnectTimeout (10 s) for each hop of a jump chain. */
const CONNECT_TIMEOUT_MS = 60_000;

export interface SshCliArgs {
  action:
    | "list"
    | "import-preview"
    | "hostkey-check"
    | "hostkey-confirm"
    | "hostkey-forget"
    | "test"
    | "remove"
    | "import-apply"
    | "add"
    | "edit";
  /** The destination, its name or its id, for every action but `list` and the two imports; the new name for `add`. */
  target?: string;
  /** The fingerprint the person accepts, for `hostkey-confirm`. */
  fingerprint?: string;
  /** The `~/.ssh/config` names `import-apply` turns into destinations. */
  aliases?: string[];
  /** The flags of `add` and `edit`. */
  save?: SshSaveFields;
  /** The person's word that `remove` deletes the destination, or that `add` or `edit` turns ForwardAgent on. */
  confirm?: boolean;
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
      (args.action === "hostkey-check" ||
      args.action === "hostkey-confirm" ||
      args.action === "test"
        ? CONNECT_TIMEOUT_MS
        : DEFAULT_TIMEOUT_MS),
    perform: async (daemon) => {
      if (
        args.action === "hostkey-check" ||
        args.action === "hostkey-confirm" ||
        args.action === "hostkey-forget" ||
        args.action === "remove" ||
        args.action === "test"
      ) {
        const { targets } = await daemon.call("ssh.list", {});
        const found = resolveSshTarget(targets, args.target ?? "");
        if ("problem" in found) return failure(1, found.problem);
        const { id, name, auth } = found.target;
        if (args.action === "remove") {
          // The daemon refuses it too, and it also refuses a destination another one goes through.
          await daemon.call("ssh.remove", { id, confirm: args.confirm === true });
          return args.json ? json({ id, name, removed: true }) : said(removedLine(name));
        }
        if (args.action === "hostkey-forget") {
          const forgotten = await daemon.call("ssh.hostkey.forget", { targetId: id });
          return args.json ? json(forgotten) : said(hostKeyForgottenLine(name));
        }
        if (args.action === "hostkey-confirm") {
          const typed = args.fingerprint ?? "";
          // A fresh scan arms the daemon's five minutes, and shows what the server presents right now.
          const check = await daemon.call("ssh.hostkey.check", { targetId: id });
          const decision = confirmDecision(name, check, typed);
          if (!decision.send) return failure(1, decision.message, decision.reason);
          const pinned = await daemon.call("ssh.hostkey.confirm", {
            targetId: id,
            fingerprint: typed,
          });
          return args.json ? json(pinned) : said(hostKeyPinnedLine(name, typed));
        }
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
      if (args.action === "add" || args.action === "edit") {
        const { targets } = await daemon.call("ssh.list", {});
        const fields = args.save ?? {};
        let jumpId: string | null | undefined = fields.noJump ? null : undefined;
        if (fields.jump !== undefined) {
          const jump = resolveSshTarget(targets, fields.jump);
          if ("problem" in jump) return failure(1, jump.problem);
          jumpId = jump.target.id;
        }
        const confirm = args.confirm === true;
        const name = args.target ?? "";
        if (args.action === "add") {
          const named = name.trim();
          if (targets.some((t) => t.name === named)) {
            return failure(
              1,
              `a destination is already named ${named}: use ssh edit ${named}`,
              "ssh_name_taken",
            );
          }
          if (targets.some((t) => t.id === named)) {
            return failure(
              1,
              `${named} is the id of another destination: pick another name`,
              "ssh_name_taken",
            );
          }
          const added = await daemon.call(
            "ssh.save",
            addPayload(name, fields, jumpId ?? undefined, confirm),
          );
          return args.json ? json(added) : said(addedLine(added.name, added.id));
        }
        const found = resolveSshTarget(targets, name);
        if ("problem" in found) return failure(1, found.problem);
        if (fields.secretRef !== undefined && (fields.auth ?? found.target.auth) === "agent") {
          return failure(
            1,
            `--secret-ref: ${found.target.name} signs in with the agent, which has no key reference: pass --auth key-file, vault-key or password`,
          );
        }
        const saved = await daemon.call(
          "ssh.save",
          editPayload(found.target, fields, jumpId, confirm),
        );
        return args.json ? json(saved) : said(updatedLine(found.target, saved));
      }
      if (args.action === "list") {
        const result = await daemon.call("ssh.list", {});
        return args.json ? json(result) : said(...targetLines(result.targets));
      }
      if (args.action === "import-apply") {
        const result = await daemon.call("ssh.import.apply", { aliases: args.aliases ?? [] });
        const base = args.json ? json(result) : said(...importResultLines(result));
        // A name that was not imported is a part of the work not done: a script sees it.
        return { ...base, code: result.skipped.length > 0 ? 1 : 0 };
      }
      const result = await daemon.call("ssh.import.preview", {});
      return args.json ? json(result) : said(...importLines(result.entries));
    },
  });
}
