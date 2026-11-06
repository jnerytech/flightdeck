import type { ReleaseList } from "@flightdeck/protocol";

export interface ReleaseFeedOptions {
  /** The GitHub API's list of the repository's releases. */
  url: string;
  fetch?: (url: string, init: { headers: Record<string, string> }) => Promise<Response>;
  now?: () => number;
}

/** The bullets of the `## Highlights` section of a release's notes, as plain text. */
export function parseHighlights(_body: string): string[] {
  return [];
}

/** The app's latest releases from GitHub, kept for an hour so a screen opened often asks once. */
export class ReleaseFeed {
  constructor(private readonly opts: ReleaseFeedOptions) {}

  async list(_limit: number): Promise<ReleaseList> {
    void this.opts;
    return { releases: [] };
  }
}
