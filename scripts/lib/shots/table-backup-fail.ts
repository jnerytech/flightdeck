/**
 * Part of the print table (scripts/demo-shots.ts): Settings > Backup when a step fails (#4348): a
 * restore that could not be written, a backup with nothing to restore, and a scheduled backup whose
 * old files could not be removed.
 */
import type { DemoIds } from "../../demo-seed.ts";
import type { Shot } from "./shot.ts";

export function backupFailShots(_ids: DemoIds): Shot[] {
  return [];
}
