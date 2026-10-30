/** The fields of a board card that explain why a smoke gave up waiting for it. */
export interface CardSnapshot {
  column?: string;
  worktreePath?: string | null;
  prState?: string | null;
  checksState?: string | null;
  notice?: string | null;
}

/** "column=review worktree=… notice=…": what a timed-out smoke prints about its card. */
export function describeCard(_card: CardSnapshot | undefined): string {
  return "";
}
