/**
 * The snippets' public entry in the app (#1589, #1596): the saved commands and prompts, the hosts'
 * and the app's own. Another domain imports from here, never a file inside.
 */
export {
  type AppSnippet,
  GlobalSnippets,
  type GlobalSnippetsOptions,
  type SnippetFilter,
} from "./global-snippets.ts";
export {
  initialSnippetsState,
  type SnippetChoice,
  type SnippetsCore,
  SnippetsSlice,
  type SnippetsSliceState,
} from "./store.ts";
