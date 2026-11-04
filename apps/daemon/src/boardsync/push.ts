/** Phase 38: switching push on for a board. Pushing itself happens in the engine's sync. */
import { FlightdeckError } from "../errors.ts";
import type { BoardProvider } from "./provider.ts";
import type { BoardLink, BoardSyncStore } from "./store.ts";

export async function setPush(
  deps: { store: BoardSyncStore; provider: BoardProvider },
  projectId: string,
  push: boolean,
  confirm: boolean,
): Promise<BoardLink> {
  if (!deps.store.get(projectId)) {
    throw new FlightdeckError(
      "invalid_state",
      "the project has no linked board",
      "board_sync_not_linked",
    );
  }
  if (push) {
    if (!confirm) {
      throw new FlightdeckError(
        "bad_request",
        "pushing changes to the board needs your confirmation",
        "board_sync_confirm",
      );
    }
    if (!(await deps.provider.scopes()).write) {
      throw new FlightdeckError(
        "invalid_state",
        "the login lacks the project scope: sign in again with it",
        "board_sync_scope_missing",
        { scope: "project" },
      );
    }
  }
  return deps.store.update(projectId, { push });
}
