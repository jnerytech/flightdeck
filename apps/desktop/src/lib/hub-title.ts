import type { SessionPersona } from "@flightdeck/protocol";

/** What a row calls a session: see `rowTitle`. Stubbed until the test commit is in. */
export interface TitleSources {
  name: string | null;
  /** The host's title for it: the summary Claude Code wrote, else the first prompt. */
  title: string | null;
  persona: SessionPersona | null;
  /** The first line of the user's last prompt. */
  request: string | null;
  cwd: string;
}

export function cleanTitle(_text: string | null | undefined): string | null {
  return "";
}

export function rowTitle(_sources: TitleSources): string {
  return "";
}
