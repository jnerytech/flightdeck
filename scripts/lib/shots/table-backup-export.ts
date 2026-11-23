/**
 * Part of the print table (scripts/demo-shots.ts): Settings > Backup > Back up everything when the
 * backup is refused (#4348): the passphrases that differ, a passphrase that is too short, and a
 * backup over the size the app can read back.
 */
import type { DemoIds } from "../../demo-seed.ts";
import type { Shot } from "./shot.ts";

/** The personas of a backup too big to be restored later: one persona with a very long note. */
export function oversizedPersonas(): string {
  return "[]";
}

export function backupExportShots(_ids: DemoIds): Shot[] {
  return [];
}
