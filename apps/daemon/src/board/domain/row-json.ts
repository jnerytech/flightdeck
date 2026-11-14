import { EffortLevel, PermissionMode } from "@flightdeck/protocol";
import { z } from "zod";

/**
 * The JSON columns of a card row, as the daemon writes them. Each schema is the shape the wire
 * `Card` carries for the same field, so a column that no longer fits reads as absent instead of
 * leaking a wrong-shaped value to the app.
 */
export const NoticeParams = z.record(z.string(), z.union([z.string(), z.number()]));

export const CardVariant = z.object({
  label: z.string(),
  model: z.string().nullable(),
  effort: EffortLevel.nullable(),
  persona: z.string().nullable().optional(),
  permissionMode: PermissionMode.nullable().optional(),
});

export const AutoStart = z.object({ workflow: z.string().nullable() });
