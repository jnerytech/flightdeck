/**
 * The terminals' components, the screens' entry (#2451): the terminal page, the close dialog, a
 * session's terminal and the button that opens one. State and wiring stay in `index.ts`, so a
 * composition file that imports it does not reach the screens.
 */

export { TerminalCloseDialog, TerminalPage } from "./page.tsx";
export { SessionTerminal } from "./session-terminal.tsx";
export { TerminalButton } from "./terminal-button.tsx";
