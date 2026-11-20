/**
 * Issue #3455: what `flightdeckd team new` sends and says, as pure rules. A member is one spec,
 * `persona[:model[:effort[:mode]]]`, where a part left empty keeps the default (the same shape as
 * `card start-arena --variant`).
 */
import {
  type CommandPayload,
  EffortLevel,
  PermissionMode,
  type TeamInfo,
} from "@flightdeck/protocol";
import { type TeamCliArgs, teamLine } from "./team-cli-view.ts";

export interface MemberSpec {
  persona?: string;
  model?: string;
  effort?: EffortLevel;
  permission?: PermissionMode;
}

const SHAPE = "persona[:model[:effort[:mode]]]";
const MAX_WORKERS = 8;

/** One member spec; a part that is not valid, or one part too many, is refused with what it takes. */
export function memberSpec(text: string): MemberSpec {
  const [persona = "", model = "", effort = "", mode = "", ...extra] = text.split(":");
  if (extra.length > 0) throw new Error(`"${text}" is not ${SHAPE}: at most 4 parts`);
  const spec: MemberSpec = {};
  if (persona) spec.persona = persona;
  if (model) spec.model = model;
  if (effort) {
    const parsed = EffortLevel.safeParse(effort);
    if (!parsed.success)
      throw new Error(`effort "${effort}" in "${text}": one of ${EffortLevel.options.join(", ")}`);
    spec.effort = parsed.data;
  }
  if (mode) {
    const parsed = PermissionMode.safeParse(mode);
    if (!parsed.success)
      throw new Error(`mode "${mode}" in "${text}": one of ${PermissionMode.options.join(", ")}`);
    spec.permission = parsed.data;
  }
  return spec;
}

/** The workers asked for, one spec each: `--workers N` is N default workers, `--worker` is one each. */
function workerSpecsOf(args: TeamCliArgs): MemberSpec[] {
  const { workers, workerSpecs } = args;
  if (workers !== undefined && workerSpecs !== undefined)
    throw new Error("--workers or --worker, not both");
  const specs =
    workerSpecs?.map(memberSpec) ??
    (workers === undefined ? undefined : Array.from({ length: workers }, () => ({})));
  if (specs === undefined) throw new Error("missing --workers or --worker");
  if (!Number.isInteger(specs.length) || specs.length < 1 || specs.length > MAX_WORKERS)
    throw new Error(`a team has 1 to ${MAX_WORKERS} workers`);
  return specs;
}

/** The `teams.create` payload for these arguments: only what the person set is sent. */
export function newTeamPayload(
  args: TeamCliArgs,
  projectId: string,
): CommandPayload<"teams.create"> {
  const specs = workerSpecsOf(args);
  const coordinator = memberSpec(args.coordinator ?? "");
  const named = specs.filter((spec) => spec.persona !== undefined).length;
  // The daemon takes a persona for every worker or for none: it has no entry for "the default".
  if (named > 0 && named < specs.length)
    throw new Error("name a persona for every worker, or for none");
  const each = <K extends keyof MemberSpec>(key: K) => specs.map((spec) => spec[key] ?? null);
  const some = (key: keyof MemberSpec) => specs.some((spec) => spec[key] !== undefined);
  return {
    projectId,
    goal: args.goal ?? "",
    workers: specs.length,
    ...(args.name === undefined ? {} : { name: args.name }),
    ...(coordinator.persona ? { coordinatorPersona: coordinator.persona } : {}),
    ...(some("persona") ? { workerPersonas: specs.map((spec) => spec.persona as string) } : {}),
    ...(coordinator.model ? { coordinatorModel: coordinator.model } : {}),
    ...(some("model") ? { workerModels: each("model") } : {}),
    ...(coordinator.permission ? { coordinatorPermission: coordinator.permission } : {}),
    ...(some("permission") ? { workerPermissions: each("permission") } : {}),
    ...(coordinator.effort ? { coordinatorEffort: coordinator.effort } : {}),
    ...(some("effort") ? { workerEfforts: each("effort") } : {}),
    ...(args.checks === undefined ? {} : { checks: args.checks }),
  };
}

/** Whether any member of the team runs in `bypassPermissions`: the app asks the person to confirm it. */
export function bypassAsked(args: TeamCliArgs): boolean {
  const specs = [args.coordinator ?? "", ...(args.workerSpecs ?? [])];
  return specs.some((spec) => memberSpec(spec).permission === "bypassPermissions");
}

/** What `team new` says: the team, and which workers wait in the run queue instead of running. */
export function createdLines(team: TeamInfo): string[] {
  const waiting = team.members.filter((m) => m.role === "worker" && m.cardId && !m.sessionId);
  return [
    `created ${teamLine(team)}`,
    ...waiting.map((m) => `${m.name}  waits in the run queue (card ${m.cardId})`),
  ];
}

/** What a `team new` that got no answer may have done. */
export const UNSURE_NEW =
  "; the team may or may not have been created: check with `team list` before trying again";
