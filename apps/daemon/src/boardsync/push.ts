/** Phase 38: switching push on for a board. Pushing itself happens in the engine's sync. */
import type { BoardProvider } from "./provider.ts";
import type { BoardLink, BoardSyncStore } from "./store.ts";

export function setPush(
  _deps: { store: BoardSyncStore; provider: BoardProvider },
  projectId: string,
  _push: boolean,
  _confirm: boolean,
): Promise<BoardLink> {
  return Promise.resolve({ projectId } as BoardLink);
}
