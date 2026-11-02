import { describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { boardTitle } from "../src/lib/board.ts";

describe("board-titulo", () => {
  test("names the project once it is known, in both languages", () => {
    expect(boardTitle(translator("en"), "alpha")).toBe("Board of alpha");
    expect(boardTitle(translator("pt-BR"), "alpha")).toBe("Board de alpha");
  });

  test("is the plain Board, with no dangling preposition, until the name is known", () => {
    expect(boardTitle(translator("en"), undefined)).toBe("Board");
    expect(boardTitle(translator("pt-BR"), undefined)).toBe("Board");
    expect(boardTitle(translator("en"), "")).toBe("Board");
  });
});
