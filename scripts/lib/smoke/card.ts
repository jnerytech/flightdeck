/** The fields of a board card that explain why a smoke gave up waiting for it. */
export interface CardSnapshot {
  column?: string;
  worktreePath?: string | null;
  prState?: string | null;
  checksState?: string | null;
  notice?: string | null;
}

/** "column=review worktree=… notice=…": what a timed-out smoke prints about its card. */
export function describeCard(card: CardSnapshot | undefined): string {
  if (!card) return "no card update seen";
  const none = (value: string | null | undefined) => value ?? "none";
  return [
    `column=${none(card.column)}`,
    `worktree=${none(card.worktreePath)}`,
    `pr=${none(card.prState)}`,
    `checks=${none(card.checksState)}`,
    `notice=${none(card.notice)}`,
  ].join(" ");
}
