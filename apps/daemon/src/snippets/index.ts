/**
 * The snippets domain's public entry (#1589): the saved snippets a person reuses, their import from
 * the history, and the scanner that keeps secrets out of them (the personas and the PR watch reuse
 * it). `main.ts` still builds the domain through `wiring.ts`, and `server-options.ts` still imports
 * `use.ts` directly: through this entry it would close an import cycle (a snippet's use reaches
 * the sessions and the central, which reach back here). Another domain imports from here, never a
 * file inside.
 */
export type { HistoryImporter } from "./history.ts";
export { SecretScanner } from "./model.ts";
export type { Snippets } from "./store.ts";
