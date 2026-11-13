import type { CommandPayload, EffortLevel } from "@flightdeck/protocol";
import type { T } from "../../i18n/index.ts";
import { type PermissionChoice, takesEffort } from "../personas/index.ts";

/** The effort a member was given; "" is the persona's own. */
export type EffortChoice = EffortLevel | "";

/** One worker row of the form: the persona (`null` until picked), the model, the effort and the permission mode. */
export interface NewTeamRow {
  persona: string | null;
  model: string;
  effort: EffortChoice;
  permission: PermissionChoice;
}

/** What the new-team form holds, and what the host in view allows. */
export interface NewTeamForm {
  projectId: string;
  goal: string;
  name: string;
  persona: string;
  model: string;
  effort: EffortChoice;
  permission: PermissionChoice;
  rows: NewTeamRow[];
  /** The persona a worker takes when its row picked none ("" when the host has no Developer). */
  workerDefault: string;
  modes: { offered: boolean; allowBypass: boolean };
  /** Whether the host announces `teams.effort`: it takes the efforts the form sends. */
  efforts: boolean;
  /** The model of each persona the host lists, by persona id (null for a persona with none). */
  personaModels: Readonly<Record<string, string | null>>;
}

/** A member's confirm: closing or deleting the team, or removing one member. */
export type TeamConfirm =
  | { kind: "close" }
  | { kind: "delete" }
  /** `label` is what the row calls the member (else its name); the line that says it is gone uses it. */
  | { kind: "remove"; member: string; label?: string };

/**
 * Whether a member's effort select shows, and its choice is sent: the host announces it and the
 * member's model takes one. `persona` is the member's persona id ("" for none).
 */
export function effortOffered(
  form: Pick<NewTeamForm, "efforts" | "personaModels">,
  model: string,
  persona: string,
): boolean {
  return form.efforts && takesEffort(model, form.personaModels[persona] ?? null);
}

/** A choice the host no longer offers (Bypass after its switch went off) is the default again. */
export const offeredChoice = (value: PermissionChoice, allowBypass: boolean): PermissionChoice =>
  value === "bypassPermissions" && !allowBypass ? "" : value;

/** The first project until another that exists is chosen; a project just added is chosen at once. */
export const chosenProject = (projects: readonly { id: string }[], picked: string): string =>
  projects.some((p) => p.id === picked) ? picked : (projects[0]?.id ?? "");

/** A row's persona: the one picked, else the worker default. */
export const rowPersona = (row: NewTeamRow, workerDefault: string): string =>
  row.persona ?? workerDefault;

/** The permission modes the form will send: the coordinator's, then each worker's. */
function modesSent(form: NewTeamForm): {
  coordinator: PermissionChoice;
  workers: PermissionChoice[];
} {
  const { allowBypass } = form.modes;
  return {
    coordinator: offeredChoice(form.permission, allowBypass),
    workers: form.rows.map((row) => offeredChoice(row.permission, allowBypass)),
  };
}

/** Whether a member on Bypass makes the form ask again before it creates the team. */
export function bypassAsked(form: NewTeamForm): boolean {
  if (!form.modes.offered) return false;
  const { coordinator, workers } = modesSent(form);
  return [coordinator, ...workers].includes("bypassPermissions");
}

/** The `teams.create` payload: what the person left blank is not sent. */
export function createPayload(form: NewTeamForm): CommandPayload<"teams.create"> {
  const { coordinator, workers } = modesSent(form);
  const personaOf = (row: NewTeamRow) => rowPersona(row, form.workerDefault);
  const name = form.name.trim();
  // An effort goes only where the host takes it and the member's model has one to give.
  const coordinatorEffort =
    effortOffered(form, form.model, form.persona) && form.effort ? form.effort : null;
  const workerEfforts = form.rows.map((row) =>
    effortOffered(form, row.model, personaOf(row)) && row.effort ? row.effort : null,
  );
  return {
    projectId: form.projectId,
    goal: form.goal,
    ...(name ? { name } : {}),
    workers: form.rows.length,
    ...(form.persona ? { coordinatorPersona: form.persona } : {}),
    ...(form.rows.some(personaOf) ? { workerPersonas: form.rows.map(personaOf) } : {}),
    ...(form.model ? { coordinatorModel: form.model } : {}),
    ...(form.rows.some((row) => row.model)
      ? { workerModels: form.rows.map((row) => row.model || null) }
      : {}),
    ...(form.modes.offered && coordinator ? { coordinatorPermission: coordinator } : {}),
    ...(form.modes.offered && workers.some(Boolean)
      ? { workerPermissions: workers.map((mode) => mode || null) }
      : {}),
    ...(coordinatorEffort ? { coordinatorEffort } : {}),
    ...(workerEfforts.some(Boolean) ? { workerEfforts } : {}),
  };
}

/** The `addMember` of `teams.update`: a blank persona or model is null, a permission only when set. */
export const memberPayload = (member: {
  persona: string;
  model: string;
  effort: EffortChoice;
  permission: PermissionChoice;
}): NonNullable<CommandPayload<"teams.update">["addMember"]> => ({
  persona: member.persona || null,
  model: member.model || null,
  ...(member.effort ? { effort: member.effort } : {}),
  ...(member.permission ? { permission: member.permission } : {}),
});

/** The words of a team confirm: the question and its button. */
export function confirmCopy(
  confirm: TeamConfirm,
  teamName: string,
  t: T,
): { message: string; label: string } {
  if (confirm.kind === "close") {
    return {
      message: t("teamsUi.closeMessage", { name: teamName }),
      label: t("teamsUi.closeButton"),
    };
  }
  if (confirm.kind === "delete") {
    return { message: t("teamsUi.deleteMessage", { name: teamName }), label: t("teamsUi.delete") };
  }
  return {
    message: t("teamsUi.removeMessage", { name: confirm.member }),
    label: t("teamsUi.removeButton"),
  };
}
