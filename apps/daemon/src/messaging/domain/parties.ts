import type { SendResult } from "@flightdeck/protocol";
import type { Party } from "./policy.ts";

/** A party known only by its place: no name, persona, project or team (a notice target, Flightdeck itself, a session not found). */
export function blankParty(id: string, host: string): Party {
  return { id, host, name: null, persona: null, projectKey: null, teamId: null };
}

/** The team two parties share, or null when either has none or they differ. */
export function sharedTeam(sender: Party, target: Party): string | null {
  return sender.teamId !== null && sender.teamId === target.teamId ? sender.teamId : null;
}

/** What a relay of a message already recorded answers again: delivered and queued stay, any other end is a refusal. */
export function relayAnswer(existing: {
  id: string;
  status: string;
  reason: string | null;
}): SendResult {
  return {
    id: existing.id,
    status:
      existing.status === "delivered" || existing.status === "queued" ? existing.status : "refused",
    reason: existing.reason,
  };
}
