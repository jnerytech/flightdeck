import type { MessagingSession } from "@flightdeck/protocol";
import { addressOf, type Party } from "./policy.ts";

/** What a listing adds to a party: the live state and the reach, which the party itself does not carry. */
export type ListingExtra = Pick<
  MessagingSession,
  "state" | "kind" | "receives" | "reason" | "alias" | "aliases"
>;

/** One session as `list_sessions` shows it: the party's identity under its address, with its state. */
export function listedSession(party: Party, extra: ListingExtra): MessagingSession {
  return {
    address: addressOf(party),
    id: party.id,
    host: party.host,
    name: party.name,
    persona: party.persona,
    projectKey: party.projectKey,
    teamId: party.teamId,
    ...extra,
  };
}
