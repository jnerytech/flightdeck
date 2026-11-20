/**
 * Issue #3455: what `flightdeckd team` says, as pure rules over the teams the daemon returns. The
 * daemon calls and the timer stay in `teams/team-cli.ts`.
 */
import type { TeamInfo, TeamStatus } from "@flightdeck/protocol";

export interface TeamCliArgs {
  action: "list" | "show" | "new" | "update" | "delete" | "add-member" | "remove-member";
  /** `list --project`: a project's name or id; only its teams are listed. */
  project?: string;
  /** `show`: the team. */
  id?: string;
  /** `--json`: the daemon's own answer, for a script. */
  json?: boolean;
  /** `new`: what the team is for, and the team's name (the daemon makes one from the goal when none). */
  goal?: string;
  name?: string;
  /** `new --workers N`: N workers with the defaults. */
  workers?: number;
  /** `new --worker <spec>` (repeats): one worker each, as `persona[:model[:effort[:mode]]]`. */
  workerSpecs?: string[];
  /** `new --coordinator <spec>`: the coordinator, as one worker spec. */
  coordinator?: string;
  /** `new --check <command>` (repeats): what the coordinator runs to check a worker's work. */
  checks?: string[];
  /** `new --confirm`: a member runs in `bypassPermissions`, which the app asks the person to confirm. */
  confirm?: boolean;
  /** `team add-member <team> [spec]`: the one worker's spec, `persona[:model[:effort[:mode]]]`. */
  spec?: string;
  /** `team remove-member <team> <member>`: the member's name, address, session or card. */
  member?: string;
  /** `team update <team> --clear-checks`: no checks left. */
  clearChecks?: boolean;
  /** `team update <team> --persona <member>=<persona>`: an empty persona is the default. */
  persona?: string;
}

/** `active`, `closed`, or `paused by user` / `paused by quota` (a plain `paused` when the host did not say who). */
const stateOf = (team: TeamInfo) =>
  team.state === "paused" && team.pausedBy ? `paused by ${team.pausedBy}` : team.state;

const workersOf = (team: TeamInfo) => {
  const count = team.members.filter((member) => member.role === "worker").length;
  return `${count} ${count === 1 ? "worker" : "workers"}`;
};

/** One line of `team list`. */
export function teamLine(team: TeamInfo): string {
  return `${team.id}  ${team.name}  ${stateOf(team)}  ${workersOf(team)}`;
}

/** The lines of `team show`: the team, then one line per member and, under it, what it last reported. */
export function showLines(status: TeamStatus): string[] {
  const { team, members, outcome } = status;
  return [
    `${team.id}  ${team.name}`,
    `state: ${stateOf(team)}`,
    `goal: ${team.goal}`,
    `messages: ${status.messages}`,
    ...(outcome ? [`outcome (${outcome.done ? "done" : "not done"}): ${outcome.text}`] : []),
    ...members.flatMap((member) => [
      [
        member.name,
        member.role,
        member.persona ?? "no persona",
        member.sessionState ?? "no session",
        ...(member.cardId ? [`card ${member.cardId}`] : []),
        `sent ${member.sent}, received ${member.received}`,
      ].join("  "),
      ...(member.lastReport ? [`  last report: ${member.lastReport.text}`] : []),
    ]),
  ];
}
