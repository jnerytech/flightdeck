import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import type { XtermDeps, XtermTerminal } from "./xterm-screen.ts";

/** The real xterm and its addons, in the pinned versions. */
export const realXtermDeps: XtermDeps = {
  terminal: (options) => new Terminal(options) as unknown as XtermTerminal,
  fit: () => new FitAddon(),
  webLinks: () => new WebLinksAddon(),
  search: () => new SearchAddon(),
  unicode11: () => new Unicode11Addon(),
};
