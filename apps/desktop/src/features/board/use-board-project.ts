import type { Project } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import type { AppStore } from "@/lib/app-store";

/**
 * A project's `board.get`: the project once the host answers, and `loadFailed` when it did not, with a
 * `loadBoard` for the retry (#2596). `hostCommand` raises the toast with the reason and answers null for
 * a refused request, so a failed request must not leave the board in its loading shape for good.
 */
export function useBoardProject(store: AppStore, hostId: string, projectId: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [loadFailed, setFailed] = useState(false);
  const loadBoard = useCallback(async () => {
    setFailed(false);
    const board = await store.hostCommand(hostId, "board.get", { projectId });
    if (board) setProject(board.project);
    else setFailed(true);
  }, [store, hostId, projectId]);
  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);
  return { project, setProject, loadFailed, loadBoard };
}
