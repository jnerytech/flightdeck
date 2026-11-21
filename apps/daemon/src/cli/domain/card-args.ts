/**
 * What the `card` flags take (#1589 split of `args.ts`): each flag with the actions that take it, refused on
 * any other. The parser in `args.ts` runs this after reading every option.
 */
import type { CliArgs } from "./cli-args.ts";
import { CONFIRM_OWNERS } from "./command-sets.ts";
import { USAGE } from "./usage.ts";

/** A `card` flag that another command reads too: that command checks its own flags, so `card` leaves it alone. */
function isAnotherCommandsFlag(flag: string, args: CliArgs): boolean {
  // `--language` also belongs to `persona`, which checks its own flags below.
  if (["--language", "--description", "--confirm"].includes(flag) && args.command === "persona")
    return true;
  // `--language` is also `review send`'s, which checks its own flags.
  if (flag === "--language" && args.command === "review") return true;
  // `--force` is also `history resume`'s, which checks its own flags.
  if (flag === "--force" && args.command === "history") return true;
  // `--confirm` is also `rules remove`'s, `autoapprove resume`'s, `team new`'s, `costs reprice`'s, `ssh remove`'s, `plugins`', `runenv trust|start`'s, `project harness-apply`'s, `boardsync set-push --on`'s, `agentcfg write`'s and `snippet`'s writes, which check their own flags below.
  return flag === "--confirm" && CONFIRM_OWNERS.includes(args.command);
}

/** The `card` flags with the actions that take each one; any other command or action is refused. */
export function refuseCardFlags(args: CliArgs): void {
  const flagged: Array<[string, unknown, readonly string[] | null]> = [
    ["--title", args.titleFlag, ["update", "pr-create"]],
    ["--description", args.description, ["new", "update", "pr-create"]],
    ["--workflow", args.workflow, ["start", "start-arena"]],
    ["--variant", args.variants, ["start-arena"]],
    ["--rounds", args.rounds, ["check-loop"]],
    ["--force", args.force, ["move"]],
    ["--position", args.position, ["move"]],
    [
      "--confirm",
      args.confirm,
      ["complete", "discard", "delete", "merge-local", "choose-variant", "check-loop"],
    ],
    ["--squash", args.squash, ["merge-local"]],
    ["--estimate", args.estimate, ["update"]],
    ["--validation-note", args.validationNote, ["update"]],
    ["--spec-path", args.specPath, ["update"]],
    ["--blocked-by", args.blockedBy, ["update"]],
    ["--language", args.language, ["review"]],
  ];
  for (const [flag, value, actions] of flagged) {
    if (value === undefined || isAnotherCommandsFlag(flag, args)) continue;
    if (args.command !== "card")
      throw new Error(`${flag}: this flag only applies to flightdeckd card\n${USAGE}`);
    if (!actions?.includes(args.action as string))
      throw new Error(
        `${flag}: this flag only applies to flightdeckd card ${(actions ?? []).join(", ")}\n${USAGE}`,
      );
  }
}
