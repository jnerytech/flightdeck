/**
 * Issue #3537: `flightdeckd ssh <verb>`, the ssh destinations of a host. The parser in `args.ts` reads
 * the words after `ssh` here; the flags are checked there, with the usage text.
 */
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const SSH_ACTIONS = ["list", "import", "hostkey", "test"] as const;

/** `ssh list`, `ssh import preview`, `ssh hostkey check|confirm|forget <target>` or `ssh test <target>` (a name or an id). */
export function readSsh(args: CliArgs, reader: ArgReader): void {
  args.command = "ssh";
  const verb = subAction(reader, SSH_ACTIONS, "invalid ssh action");
  if (verb === "import") {
    subAction(reader, ["preview"] as const, "invalid ssh import action");
    args.action = "import-preview";
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
  if (verb === "test") args.sshTarget = operand(reader, "the ssh target");
}

/** The flag of `ssh hostkey confirm`, for the parser's table of flags. */
export const SSH_FLAGS: Record<
  string,
  (args: CliArgs, reader: unknown, value: () => string) => void
> = {
  "--fingerprint": (args, _reader, value) => {
    args.sshFingerprint = value();
  },
};

/** What is wrong with the ssh flags, or undefined: only `hostkey confirm` takes a fingerprint, and it must take one. */
export function sshProblem(args: CliArgs): string | undefined {
  const confirming = args.command === "ssh" && args.action === "hostkey-confirm";
  if (args.sshFingerprint !== undefined && !confirming)
    return "--fingerprint: this flag only applies to flightdeckd ssh hostkey confirm";
  if (!confirming) return undefined;
  if (args.sshFingerprint === undefined) return "missing --fingerprint";
  if (!/^SHA256:\S+$/.test(args.sshFingerprint))
    return `--fingerprint: a SHA256 fingerprint, like SHA256:abc..., got ${args.sshFingerprint}`;
  return undefined;
}
