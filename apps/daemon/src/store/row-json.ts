import { EffortLevel, PermissionMode, PersonaAgent } from "@flightdeck/protocol";
import { z } from "zod";
import type { PersonaSnapshot } from "../personas/snapshot.ts";

/** The JSON columns of the session store, as the store writes them (#1609). */
/** `PersonaSnapshot` as a schema, so a column is checked before a session starts from it. */
export const PersonaSnapshotJson: z.ZodType<PersonaSnapshot> = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  hash: z.string().nullable(),
  append: z.string(),
  model: z.string().nullable(),
  effort: EffortLevel.nullable(),
  tools: z.array(z.string()).nullable(),
});

export const AgentsJson = z.record(z.string(), PersonaAgent);

/** The payload of a `session.mode` event. */
export const ModePayload = z.object({ permissionMode: PermissionMode });
