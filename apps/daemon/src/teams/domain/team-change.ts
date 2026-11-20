/**
 * Issue #3455: what `flightdeckd team update`, `delete`, `add-member` and `remove-member` send and say, as
 * pure rules. `team update` is one `teams.update` that may carry a goal, the checks and a member's persona;
 * a member is added or removed by the same request.
 */
import type { CommandPayload, TeamInfo } from "@flightdeck/protocol";
import { type TeamCliArgs, teamLine } from "./team-cli-view.ts";
import { memberSpec, waitingLines } from "./team-new.ts";

type Update = CommandPayload<"teams.update">;

/** `--persona member=persona`: the member's name may hold an equals sign only after the first one; no persona is the default. */
function personaChange(text: string): NonNullable<Update["persona"]> {
  const at = text.indexOf("=");
  const member = at < 0 ? "" : text.slice(0, at).trim();
  if (!member) throw new Error(`--persona "${text}" is not member=persona`);
  const persona = text.slice(at + 1).trim();
  return { member, persona: persona === "" ? null : persona };
}

/** The `teams.update` payload of `team update`: only what the person set, and something at least. */
export function updatePayload(args: TeamCliArgs): Update {
  if (args.checks !== undefined && args.clearChecks)
    throw new Error("--check or --clear-checks, not both");
  const checks = args.clearChecks ? [] : args.checks;
  const payload: Update = {
    team: args.id ?? "",
    ...(args.goal === undefined ? {} : { goal: args.goal }),
    ...(checks === undefined ? {} : { checks }),
    ...(args.persona === undefined ? {} : { persona: personaChange(args.persona) }),
  };
  if (Object.keys(payload).length === 1)
    throw new Error("nothing to change: pass --goal, --check, --clear-checks or --persona");
  return payload;
}

/** Whether the worker of `team add-member` runs in `bypassPermissions`: the app asks the person to confirm it. */
export function addsBypass(args: TeamCliArgs): boolean {
  return memberSpec(args.spec ?? "").permission === "bypassPermissions";
}

/** The `teams.update` payload of `team add-member`: one worker, each part left out keeps its default. */
export function addMemberPayload(args: TeamCliArgs): Update {
  return { team: args.id ?? "", addMember: memberSpec(args.spec ?? "") };
}

/** What a change says: what was done, the team as it is now, and which workers wait in the run queue. */
export function changedLines(team: TeamInfo, action: TeamCliArgs["action"]): string[] {
  const done = {
    update: "updated",
    delete: "deleted",
    "add-member": "member added to",
    "remove-member": "member removed from",
  } as Record<string, string>;
  return [
    `${done[action] ?? action} ${teamLine(team)}`,
    // Only the member just added: the workers that waited before are not news.
    ...(action === "add-member" ? waitingLines({ ...team, members: team.members.slice(-1) }) : []),
  ];
}

/** What a change that got no answer may have done. */
export const UNSURE_CHANGE: Record<
  Exclude<TeamCliArgs["action"], "list" | "show" | "new">,
  string
> = {
  pause: "",
  resume: "",
  close: "",
  message: "",
  update: "; the team may or may not have been applied: check with `team show` before trying again",
  delete: "; the team may or may not have been deleted: check with `team list` before trying again",
  "add-member":
    "; the member may or may not have been added: check with `team show` before trying again",
  "remove-member":
    "; the member may or may not have been removed: check with `team show` before trying again",
};
