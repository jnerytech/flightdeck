/**
 * Issue #3455: what `flightdeckd team` says, as pure rules over the teams the daemon returns. The
 * daemon calls and the timer stay in `teams/team-cli.ts`.
 */
import type { TeamInfo, TeamStatus } from "@flightdeck/protocol";

export interface TeamCliArgs {
  action: "list" | "show";
  /** `list --project`: the id of the project whose teams are listed. */
  project?: string;
  /** `show`: the team. */
  id?: string;
  /** `--json`: the daemon's own answer, for a script. */
  json?: boolean;
}

/** One line of `team list`. */
export function teamLine(_team: TeamInfo): string {
  return "";
}

/** The lines of `team show`. */
export function showLines(_status: TeamStatus): string[] {
  return [];
}
