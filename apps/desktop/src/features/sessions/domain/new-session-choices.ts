/** The folder last chosen on a host: one of its roots and the subfolder under it. */
export interface RememberedFolder {
  root: string;
  sub: string;
}

/** The models the form offers for a Claude session; nothing else is kept as the starting model. */
export const CLAUDE_MODELS: readonly string[] = ["opus", "sonnet", "haiku"];
