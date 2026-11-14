/**
 * What a team keeps as JSON in its row (#1609): the members and the checks, read through schemas so
 * a damaged row reads as empty instead of throwing.
 */
import { PermissionMode, type TeamInfo } from "@flightdeck/protocol";
import { z } from "zod";

/** What a team keeps of a member; the live session of a worker comes from its card. */
const STORED_MEMBER = z.object({
  name: z.string(),
  role: z.enum(["coordinator", "worker"]),
  persona: z.string().nullable(),
  model: z.string().nullable().optional(),
  /** Issue #93: the permission mode it was asked to open in. */
  permission: PermissionMode.nullable().optional(),
  cardId: z.string().nullable(),
  sessionId: z.string().nullable(),
  /** A worker's number in the team (issue #101); absent from a team saved before. */
  number: z.number().nullable().optional(),
});
export type StoredMember = z.infer<typeof STORED_MEMBER>;
export const STORED_MEMBERS = z.array(STORED_MEMBER);
export const STORED_CHECKS = z.array(z.string());

/** A `teams` table row as SQLite hands it back. */
export interface TeamRow {
  id: string;
  name: string;
  project_id: string;
  goal: string;
  coordinator: string | null;
  members: string;
  checks: string;
  state: TeamInfo["state"];
  paused_by: TeamInfo["pausedBy"];
  instructions_version: string;
  created_at: string;
  /** #1220: the coordinator's last report; null before the first. */
  report_text: string | null;
  report_at: string | null;
  report_done: number;
}
