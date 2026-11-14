export interface SnapshotRow {
  claudeSessionId: string;
  n: number;
  ref: string;
  tree: string;
  /** `before` and `after` a turn, or `safety` (taken before a rewind, to undo it). */
  kind: string;
  /** Uuid of the user's message in the transcript, when known. */
  turnUuid: string | null;
  prompt: string | null;
  createdAt: string;
  /** Top of the repository the ref lives in. */
  repo: string;
}
