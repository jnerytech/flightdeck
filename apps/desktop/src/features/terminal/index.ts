/**
 * The terminals of every host, public entry in the app (#1589, #1596): a host's terminal commands,
 * the tab, "Claude aqui", the person's own terminal, the listeners that follow the output and the
 * close that asks detach or end. Another domain imports from here, never a file inside.
 */
export { type ClosingTerminal, type TerminalListener, TerminalsSlice } from "./store.ts";
