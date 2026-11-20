/**
 * Issue #3455: what `flightdeckd team` says, as pure rules over the teams the daemon returns. The
 * daemon calls and the timer stay in `teams/team-cli.ts`.
 */
import type { TeamInfo, TeamStatus } from "@flightdeck/protocol";

export interface TeamCliArgs {
  action: "list" | "show";
  /** `list --project`: a project's name or id; only its teams are listed. */
  project?: string;
  /** `show`: the team. */
  id?: string;
  /** `--json`: the daemon's own answer, for a script. */
  json?: boolean;
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
