/**
 * Issue #3537: `flightdeckd ssh <verb>`, the ssh destinations of a host. The parser in `args.ts` reads
 * the words after `ssh` here; the flags are checked there, with the usage text.
 */
import { type ArgReader, operand, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const SSH_ACTIONS = ["list", "import", "hostkey", "test"] as const;

/** `ssh list`, `ssh import preview`, `ssh hostkey check <target>` or `ssh test <target>` (a name or an id). */
export function readSsh(args: CliArgs, reader: ArgReader): void {
  args.command = "ssh";
  const verb = subAction(reader, SSH_ACTIONS, "invalid ssh action");
  if (verb === "import") {
    subAction(reader, ["preview"] as const, "invalid ssh import action");
    args.action = "import-preview";
    return;
  }
  if (verb === "hostkey") {
    subAction(reader, ["check"] as const, "invalid ssh hostkey action");
    args.action = "hostkey-check";
    args.sshTarget = operand(reader, "the ssh target");
    return;
  }
  args.action = verb;
  if (verb === "test") args.sshTarget = operand(reader, "the ssh target");
}
