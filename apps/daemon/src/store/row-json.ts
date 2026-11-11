import { EffortLevel, PermissionMode, PersonaAgent } from "@flightdeck/protocol";
import { z } from "zod";
import type { PersonaSnapshot } from "../personas/snapshot.ts";

// The JSON columns of the session store, as the store writes them (#1609).

/**
 * `PersonaSnapshot` as a schema, so a column is checked before a session starts from it. A row
 * from an older daemon lacks the later fields: they read as empty, and keys it does not know stay.
 */
export const PersonaSnapshotJson: z.ZodType<PersonaSnapshot> = z.looseObject({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable().default(null),
  hash: z.string().nullable().default(null),
  append: z.string().default(""),
  model: z.string().nullable().default(null),
  effort: EffortLevel.nullable().default(null),
  tools: z.array(z.string()).nullable().default(null),
});

/** The subagents a session opened with, by name. */
export const AgentsJson = z.record(z.string(), PersonaAgent);

/** The payload of a `session.mode` event. */
export const ModePayload = z.object({ permissionMode: PermissionMode });
