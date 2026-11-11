/**
 * The workflows' public entry in the app (#1589, #1596): what a card's workflow shows and picks
 * outside its own screen, the alerts a launch can start from. Another domain imports from here,
 * never a file inside. The workflows screen (`page.tsx`, with the templates) is left out on
 * purpose: `ui/Screens.tsx` loads it as a lazy chunk, and exporting it here would pull it into the
 * main bundle.
 */
export { AlertPicker } from "./alert-picker.tsx";
