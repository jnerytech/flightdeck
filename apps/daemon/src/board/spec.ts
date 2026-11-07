/** What the daemon learns of a card's spec file: that it is there, and its first heading. */
export interface SpecFound {
  found: boolean;
  heading: string | null;
}

/** Stub: nothing is found. */
export async function readSpec(_root: string, _path: string): Promise<SpecFound> {
  return { found: false, heading: null };
}
