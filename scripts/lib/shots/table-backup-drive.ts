/**
 * Part of the print table (scripts/demo-shots.ts): Settings > Backup where Google Drive is a choice
 * (#4348). The demo's address gives the page a Google client and a fake Google (`?google=`), so the
 * prints reach the Drive states the other backup prints cannot: nothing real is called.
 */
import type { DemoIds } from "../../demo-seed.ts";
import type { Shot } from "./shot.ts";

export function backupDriveShots(_ids: DemoIds): Shot[] {
  return [];
}
