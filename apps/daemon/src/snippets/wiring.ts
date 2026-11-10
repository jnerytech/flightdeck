import type { Database } from "bun:sqlite";
import type { Config } from "../config.ts";
import { defaultHistorySources, HistoryImporter } from "./history.ts";
import type { SecretScanner } from "./model.ts";
import { Snippets } from "./store.ts";
import { SnippetUse, type SnippetUseOptions } from "./use.ts";

/** What the host's snippets are built from. */
export interface SnippetsDeps {
  db: Database;
  config: Pick<Config, "allowedRoots">;
  /** The host's scanner (the vault's values among them): nothing secret is saved or imported. */
  scanner: SecretScanner;
  /** Where a snippet is used: the sessions, the terminals and the runner. */
  use: Omit<SnippetUseOptions, "snippets" | "allowedRoots">;
  /** Where the shells keep their history, for the import the person asks for. */
  history: Parameters<typeof defaultHistorySources>[0];
}

/**
 * The host's snippets (issue #1593): the store, their use in a session or a terminal, and the
 * import from the shells' history.
 */
export function createSnippets({ db, config, scanner, use, history }: SnippetsDeps) {
  const snippets = new Snippets({ db, allowedRoots: config.allowedRoots, scanner });
  return {
    snippets,
    snippetUse: new SnippetUse({ ...use, snippets, allowedRoots: config.allowedRoots }),
    snippetHistory: new HistoryImporter({
      sources: defaultHistorySources(history),
      scanner,
      snippets,
    }),
  };
}
