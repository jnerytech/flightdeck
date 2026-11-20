/**
 * Issue #3537: `flightdeckd ssh <verb>`, the ssh destinations of a host. The parser in `args.ts` reads
 * the words after `ssh` here; the flags are checked there, with the usage text.
 */
import { type ArgReader, subAction } from "./arg-reader.ts";
import type { CliArgs } from "./cli-args.ts";

const SSH_ACTIONS = ["list", "import"] as const;

/** `ssh list`, or `ssh import preview`: neither takes a target. */
export function readSsh(args: CliArgs, reader: ArgReader): void {
  args.command = "ssh";
  const verb = subAction(reader, SSH_ACTIONS, "invalid ssh action");
  if (verb === "import") {
    subAction(reader, ["preview"] as const, "invalid ssh import action");
    args.action = "import-preview";
    return;
  }
  args.action = verb;
}
