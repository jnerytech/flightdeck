import type { TaskResultsResult } from "@flightdeck/protocol";

/** Names, sizes and times of the files of some folders, to compare with later. */
export type Snapshot = Record<string, { size: number; mtimeMs: number }>;

/** Remembers what a task's folders held when it started, and says what it made since. */
export class TaskTracker {
  constructor(readonly opts: { dir: string; cap?: number }) {}

  /** A look at the folders before the task starts. */
  async prepare(_folders: readonly string[]): Promise<Snapshot> {
    return {};
  }

  /** Keeps the look under the task's session. */
  async keep(_sessionId: string, _folders: readonly string[], _before: Snapshot): Promise<void> {}

  /** The files the task made or changed since. */
  async results(_sessionId: string): Promise<TaskResultsResult> {
    return { files: [], truncated: false };
  }
}
