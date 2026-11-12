import { expect, test } from "bun:test";
import { loadLastBoards } from "../../src/features/board/board-shortcut.ts";

test("a last board that is not a board id is left out and the others stay (#1609)", () => {
  const raw = '{"h1":"board-a","h2":7,"h3":null}';
  const storage = {
    getItem: (key: string) => (key === "flightdeck.lastBoards" ? raw : null),
    setItem: () => {},
  };
  expect(loadLastBoards(storage)).toEqual({ h1: "board-a" });
});
