/** Which commands take `--json` and `--host` (#1589 split of `args.ts`), and the refusal of one on any other. */
import { USAGE } from "./usage.ts";

/** The commands that take `--json` and `--host`; a flag on any other is refused with this list. */
export const JSON_COMMANDS =
  "card board history team persona quota usage budget costs roi host sessions session ssh terminal watch requests send approve deny approvers rules autoapprove vault plugins project".split(
    " ",
  );
export const HOST_COMMANDS =
  "host sessions session ssh terminal watch requests send approve deny vault plugins project".split(
    " ",
  );

export function refuseOutside(flag: string, commands: readonly string[], command: string): void {
  if (commands.includes(command)) return;
  const list = `${commands.slice(0, -1).join(", ")} and ${commands.at(-1)}`;
  throw new Error(`${flag}: this flag only applies to flightdeckd ${list}\n${USAGE}`);
}
