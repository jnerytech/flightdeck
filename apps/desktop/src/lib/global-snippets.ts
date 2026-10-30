import type { Snippet, SnippetContext, SnippetInput } from "@flightdeck/protocol";
import type { Platform } from "../platform/types.ts";

/** A snippet the screen and the palette show: the daemon's, or a global one kept by the app. */
export type AppSnippet = Omit<Snippet, "scope" | "source"> & {
  scope: Snippet["scope"] | "global";
  source: Snippet["source"] | "app";
};

export interface SnippetFilter {
  query?: string;
  type?: "command" | "prompt";
  tag?: string;
}

export interface GlobalSnippetsOptions {
  clock?: () => number;
  newId?: () => string;
}

/** Phase 18: the global snippets, in the app's storage, checked by the daemon's own model. */
export class GlobalSnippets {
  constructor(_platform: Pick<Platform, "storage">, _options: GlobalSnippetsOptions = {}) {}

  list(_filter: SnippetFilter = {}): AppSnippet[] {
    return [];
  }

  /** Creates (no `id`) or edits; refuses like the daemon (`bad_request`, `snippet_secret`). */
  save(_input: SnippetInput & { id?: string }): AppSnippet {
    return {} as AppSnippet;
  }

  remove(_id: string): void {}

  favorite(_id: string, _favorite: boolean): void {}

  /** Fills the template and counts the use. */
  use(_id: string, _values: Record<string, string>, _context: SnippetContext): string {
    return "";
  }
}
