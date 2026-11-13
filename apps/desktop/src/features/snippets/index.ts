/**
 * The snippets' public entry in the app (#1589, #1596): the saved commands and prompts, the hosts'
 * and the app's own. Another domain imports from here, never a file inside. The page itself
 * (`page.tsx`) is left out on purpose: `ui/Screens.tsx` loads it as a lazy chunk, and
 * exporting it here would pull it into the main bundle.
 */

export {
  type AppSnippet,
  GlobalSnippets,
  type GlobalSnippetsOptions,
  type SnippetFilter,
} from "./global-snippets.ts";
export type { PromptSnippets } from "./prompt-menu.tsx";
export type { MenuGroup, MenuItem } from "./prompt-menu-model.ts";
export type { ActionSeed } from "./snippets.ts";
export {
  initialSnippetsState,
  type SnippetChoice,
  type SnippetsCore,
  SnippetsSlice,
  type SnippetsSliceState,
} from "./store.ts";
export { wireSnippets } from "./wire.ts";
