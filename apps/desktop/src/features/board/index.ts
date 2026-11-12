/**
 * The board's public entry in the app (#1589, #1597): the pure parts other domains read, the
 * contract and start checks a launch asks, the bulk and selection answers, the files panel's
 * target, the last board each project opened, and the cards the app has seen (the store's slice). Another domain imports from here, never a file
 * inside. The screen and its dialogs stay out so the board loads lazily.
 */

export { queueSplit } from "./board-bulk.ts";
export { BoardCardsSlice } from "./board-cards.ts";
export { type Lacking, startNeeds } from "./board-contracts.ts";
export type { BoardFiles } from "./board-files.ts";
export { answerOf, BoardWidth, type BulkRefusal } from "./board-select.ts";
export { boardShortcut, loadLastBoards, saveLastBoard } from "./board-shortcut.ts";
export { cardStartBlock } from "./card-start-block.ts";
