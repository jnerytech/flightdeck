/**
 * The clients' public entry in the app (#1589, #1597): the chip, the sidebar switcher and the menu
 * that assigns a project to a client. The Clients screen is loaded by its own file, lazily. Another
 * domain imports from here, never a file inside.
 */
export { AssignMenu } from "./assign-menu.tsx";
export { ClientChip } from "./client-chip.tsx";
export { ClientSwitcher } from "./client-switcher.tsx";
