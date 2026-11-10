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
  terminals: SnippetUseOptions["terminals"];
  manager: SnippetUseOptions["manager"];
  onPersonInput: SnippetUseOptions["onPersonInput"];
  central: SnippetUseOptions["central"];
  exec: SnippetUseOptions["exec"];
  /** Where the shells keep their history, for the import the person asks for. */
  home: string;
  appData: string | undefined;
  platform: NodeJS.Platform;
}

/**
 * The host's snippets (issue #1593): the store, their use in a session or a terminal, and the
 * import from the shells' history.
 */
export function createSnippets(deps: SnippetsDeps) {
  const { config, scanner } = deps;
  const snippets = new Snippets({
    db: deps.db,
    allowedRoots: config.allowedRoots,
    scanner,
  });
  return {
    snippets,
    snippetUse: new SnippetUse({
      snippets,
      terminals: deps.terminals,
      manager: deps.manager,
      onPersonInput: deps.onPersonInput,
      central: deps.central,
      exec: deps.exec,
      allowedRoots: config.allowedRoots,
    }),
    snippetHistory: new HistoryImporter({
      sources: defaultHistorySources({
        home: deps.home,
        appData: deps.appData,
        platform: deps.platform,
      }),
      scanner,
      snippets,
    }),
  };
}
