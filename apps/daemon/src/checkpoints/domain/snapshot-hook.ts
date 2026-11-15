export interface SnapshotInput {
  cwd: string;
  claudeSessionId: string;
  kind: "before" | "after" | "safety";
  prompt?: string;
  turnUuid?: string;
}

/**
 * The snapshot a terminal session's hook asks for: before the turn on UserPromptSubmit (with
 * the prompt), after it on Stop; nothing for the other hooks or without a cwd.
 */
export function snapshotForHook(
  event: string,
  payload: { session_id?: unknown; cwd?: unknown; prompt?: unknown },
): SnapshotInput | null {
  let kind: SnapshotInput["kind"] | null = null;
  if (event === "UserPromptSubmit") kind = "before";
  else if (event === "Stop") kind = "after";
  if (!kind || typeof payload.cwd !== "string" || typeof payload.session_id !== "string") {
    return null;
  }
  return {
    cwd: payload.cwd,
    claudeSessionId: payload.session_id,
    kind,
    ...(typeof payload.prompt === "string" ? { prompt: payload.prompt } : {}),
  };
}

/** What a turn changed in the files: git's letters as words, and the lines added and removed. */
export interface TurnFiles {
  files: Array<{ path: string; change: string }>;
  insertions: number;
  deletions: number;
}

export const CHANGES: Record<string, string> = { M: "modified", A: "created", D: "deleted" };
