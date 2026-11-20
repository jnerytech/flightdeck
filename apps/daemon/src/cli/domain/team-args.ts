/**
 * Issue #3455: what `flightdeckd team new` takes and needs, checked before anything is sent. The
 * parser in `args.ts` adds the usage text to the problem this names. The member specs themselves
 * (`persona[:model[:effort[:mode]]]`) are checked by the command, which owns their format.
 */

/** The parsed arguments this check reads: `CliArgs` fits it. */
export interface TeamArgs {
  command: string;
  action?: string;
  teamGoal?: string;
  teamWorkers?: number;
  teamWorkerSpecs?: string[];
  teamCoordinator?: string;
  teamChecks?: string[];
  teamGoalFlag?: string;
  teamText?: string;
  teamMember?: string;
  teamSpec?: string;
  teamPersona?: string;
  teamClearChecks?: boolean;
  personaName?: string;
  confirm?: boolean;
}

const MAX_WORKERS = 8;

/** The flags of `team`, each with the verbs that take it (`--name` and `--confirm` are other commands' too). */
function teamFlags(args: TeamArgs): Array<[string, unknown, readonly string[]]> {
  return [
    ["--workers", args.teamWorkers, ["new"]],
    ["--worker", args.teamWorkerSpecs, ["new"]],
    ["--coordinator", args.teamCoordinator, ["new"]],
    ["--check", args.teamChecks, ["new", "update"]],
    ["--clear-checks", args.teamClearChecks, ["update"]],
    ["--persona", args.teamPersona, ["update"]],
    ["--goal", args.teamGoalFlag, ["update"]],
    ...(args.command === "team"
      ? ([
          ["--name", args.personaName, ["new"]],
          ["--confirm", args.confirm, ["new", "delete", "add-member", "remove-member", "close"]],
        ] as Array<[string, unknown, readonly string[]]>)
      : []),
  ];
}

/** What is wrong with the `team` flags: a flag of another verb, or one `team new` cannot do without. */
export function teamProblem(args: TeamArgs): string | undefined {
  for (const [flag, value, verbs] of teamFlags(args)) {
    if (value === undefined) continue;
    if (args.command !== "team" || !verbs.includes(args.action as string))
      return `${flag}: this flag only applies to flightdeckd team ${verbs.join(", ")}`;
  }
  if (args.command !== "team" || args.action !== "new") return undefined;
  if (args.teamGoal === undefined || args.teamGoal.trim() === "") return "missing the goal";
  const { teamWorkers: workers, teamWorkerSpecs: specs } = args;
  if (workers !== undefined && specs !== undefined) return "--workers or --worker, not both";
  if (workers === undefined && specs === undefined) return "missing --workers or --worker";
  if (
    workers !== undefined &&
    !(Number.isInteger(workers) && workers >= 1 && workers <= MAX_WORKERS)
  )
    return `--workers: a whole number from 1 to ${MAX_WORKERS}`;
  if (specs !== undefined && specs.length > MAX_WORKERS)
    return `--worker: a team has 1 to ${MAX_WORKERS} workers`;
  return undefined;
}
