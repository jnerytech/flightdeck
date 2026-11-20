/**
 * Issue #3454: what `flightdeckd board settings` says, as pure rules over the daemon's answer. The
 * daemon call and the exit codes stay in `board/board-cli.ts`.
 */
import type { BoardSettings, Card } from "@flightdeck/protocol";

export interface BoardCliArgs {
  action: "settings" | "watch";
  /** `settings --max-parallel-runs`: the new limit; without it `settings` only reads. */
  maxParallelRuns?: number;
  /** `--json`: the daemon's own answer, for a script. */
  json?: boolean;
}

/** What a write that got no answer may have done, as text that follows the message. */
export const UNSURE =
  "; the setting may or may not have been changed: check with `board settings` before trying again";

/** The line `settings` prints. */
export function settingsLine(settings: BoardSettings): string {
  return `max parallel runs: ${settings.maxParallelRuns}`;
}

/** The line `watch` prints for a card that changed; the same words as `card list`. */
export function watchLine(_card: Card): string {
  return "";
}
