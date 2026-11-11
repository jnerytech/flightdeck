import type { PermissionChoice } from "../personas/index.ts";
import type { T } from "../../i18n/index.ts";

export interface NewTeamRow {
  persona: string | null;
  model: string;
  permission: PermissionChoice;
}

export interface NewTeamForm {
  projectId: string;
  goal: string;
  name: string;
  persona: string;
  model: string;
  permission: PermissionChoice;
  rows: NewTeamRow[];
  workerDefault: string;
  modes: { offered: boolean; allowBypass: boolean };
}

export type TeamConfirm = { kind: "close" } | { kind: "delete" } | { kind: "remove"; member: string };

export const offeredChoice = (value: PermissionChoice, _allowBypass: boolean): PermissionChoice =>
  value;

export const chosenProject = (_projects: readonly { id: string }[], picked: string): string =>
  picked;

export const bypassAsked = (_form: NewTeamForm): boolean => false;

export const createPayload = (_form: NewTeamForm): Record<string, unknown> => ({});

export const memberPayload = (_member: NewTeamRow & { persona: string }): Record<string, unknown> => ({});

export const confirmCopy = (_c: TeamConfirm, _teamName: string, _t: T): { message: string; label: string } => ({
  message: "",
  label: "",
});
