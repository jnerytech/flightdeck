/**
 * Issue #3537: `flightdeckd ssh <verb>`, the ssh destinations of a host. The parser in `args.ts` reads
 * the words after `ssh` here; the flags are checked there, with the usage text.
 */

import type { SshCliArgs } from "../../ssh/index.ts";
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const SSH_ACTIONS = ["list", "import", "hostkey", "test", "remove"] as const;
/** The daemon takes at most this many names in one `ssh.import.apply`. */
const MAX_ALIASES = 500;

/** `ssh list`, `ssh import preview`, `ssh hostkey check|confirm|forget <target>` or `ssh test <target>` (a name or an id). */
export function readSsh(args: CliArgs, reader: ArgReader): void {
  args.command = "ssh";
  const verb = subAction(reader, SSH_ACTIONS, "invalid ssh action");
  if (verb === "import") {
    const action = subAction(reader, ["preview", "apply"] as const, "invalid ssh import action");
    args.action = `import-${action}`;
    return;
  }
  if (verb === "hostkey") {
    const action = subAction(
      reader,
      ["check", "confirm", "forget"] as const,
      "invalid ssh hostkey action",
    );
    args.action = `hostkey-${action}`;
    args.sshTarget = operand(reader, "the ssh target");
    return;
  }
  args.action = verb;
  if (verb === "test" || verb === "remove") args.sshTarget = operand(reader, "the ssh target");
}

/** The flags of `ssh hostkey confirm` and `ssh import apply`, for the parser's table of flags. */
export const SSH_FLAGS: Record<
  string,
  (args: CliArgs, reader: unknown, value: () => string) => void
> = {
  "--fingerprint": (args, _reader, value) => {
    args.sshFingerprint = value();
  },
  "--alias": (args, _reader, value) => {
    args.sshAliases = [...(args.sshAliases ?? []), value()];
  },
};

/** What is wrong with the ssh flags, or undefined: each flag belongs to one verb, and that verb needs it. */
export function sshProblem(args: CliArgs): string | undefined {
  const ssh = args.command === "ssh";
  const confirming = ssh && args.action === "hostkey-confirm";
  if (args.sshFingerprint !== undefined && !confirming)
    return "--fingerprint: this flag only applies to flightdeckd ssh hostkey confirm";
  const applying = ssh && args.action === "import-apply";
  if (args.sshAliases !== undefined && !applying)
    return "--alias: this flag only applies to flightdeckd ssh import apply";
  const removing = ssh && args.action === "remove";
  if (ssh && args.confirm !== undefined && !removing)
    return "--confirm: this flag only applies to flightdeckd ssh remove";
  if (removing && args.confirm === undefined)
    return "ssh remove deletes the destination: pass --confirm";
  if (applying) {
    const count = args.sshAliases?.length ?? 0;
    if (count === 0) return "ssh import apply needs at least one --alias <name from ~/.ssh/config>";
    if (count > MAX_ALIASES) return `ssh import apply takes at most ${MAX_ALIASES} --alias`;
  }
  if (!confirming) return undefined;
  if (args.sshFingerprint === undefined) return "missing --fingerprint";
  if (!/^SHA256:\S+$/.test(args.sshFingerprint))
    return `--fingerprint: a SHA256 fingerprint, like SHA256:abc..., got ${args.sshFingerprint}`;
  return undefined;
}

/** What the ssh runner takes from the parsed arguments: each field only when the person gave it. */
export function sshCliArgs(args: CliArgs): SshCliArgs {
  return {
    action: args.action as SshCliArgs["action"],
    ...(args.sshTarget === undefined ? {} : { target: args.sshTarget }),
    ...(args.sshFingerprint === undefined ? {} : { fingerprint: args.sshFingerprint }),
    ...(args.sshAliases === undefined ? {} : { aliases: args.sshAliases }),
    ...(args.confirm ? { confirm: true } : {}),
    ...(args.json ? { json: true } : {}),
  };
}
