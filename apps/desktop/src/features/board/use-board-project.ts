import type { Project } from "@flightdeck/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppStore } from "@/lib/app-store";

/**
 * A project's `board.get`: the project once the host answers, and `loadFailed` when it did not, with a
 * `loadBoard` for the retry (#2596). `hostCommand` raises the toast with the reason and answers null for
 * a refused request, so a failed request must not leave the board in its loading shape for good.
 */
export function useBoardProject(store: AppStore, hostId: string, projectId: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [loadFailed, setFailed] = useState(false);
  /** The latest request: an answer that comes after a newer one was sent is dropped. */
  const latest = useRef(0);
  const loadBoard = useCallback(async () => {
    const mine = ++latest.current;
    setFailed(false);
    // The page has its own retry, so the toast offers none that would throw the answer away.
    const board = await store.hostCommand(hostId, "board.get", { projectId }, { retry: false });
    if (mine !== latest.current) return;
    if (board) setProject(board.project);
    else setFailed(true);
  }, [store, hostId, projectId]);
  useEffect(() => {
    // Another project: its board loads from scratch, not under the last one's.
    setProject(null);
    void loadBoard();
    return () => {
      latest.current += 1;
    };
  }, [loadBoard]);
  return { project, setProject, loadFailed, loadBoard };
}
