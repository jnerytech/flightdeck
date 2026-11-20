import type { CommandPayload, TeamInfo } from "@flightdeck/protocol";
import type { TeamCliArgs } from "./team-cli-view.ts";

export function updatePayload(_args: TeamCliArgs): CommandPayload<"teams.update"> {
  return { team: "" };
}

export function addMemberPayload(_args: TeamCliArgs): CommandPayload<"teams.update"> {
  return { team: "" };
}

export function changedLines(_team: TeamInfo, _what: string): string[] {
  return [];
}

export const UNSURE_CHANGE: Record<"update" | "delete" | "add-member" | "remove-member", string> = {
  update: "",
  delete: "",
  "add-member": "",
  "remove-member": "",
};
