import { afterEach, describe, expect, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { DiffView } = await import("../src/ui/DiffView.tsx");
const { TContext } = await import("../src/i18n/context.tsx");

afterEach(cleanup);

/**
 * Issue #1177 (round 5 of #168): commenting on a diff line was invisible until a hover, and each
 * line number was a Tab stop, so a 300-line diff took 300 presses to pass. A line under the view
 * says how to comment; each file is one Tab stop, and the arrows move between its line numbers.
 */
const file = (path: string, count: number) =>
  ({
    path,
    oldPath: null,
    status: "modified",
    additions: count,
    deletions: 0,
    uncommitted: true,
    binary: false,
    tooLarge: false,
    hunks: [
      {
        header: `@@ -0,0 +1,${count} @@`,
        lines: Array.from({ length: count }, (_, i) => ({ op: "+", text: `line ${i + 1}` })),
      },
    ],
  }) as never;

const view = (language: "en" | "pt-BR", onPick?: () => void) => (
  <TContext.Provider value={translator(language)}>
    <DiffView
      files={[file("a.ts", 4), file("b.ts", 3)]}
      mode="unified"
      selection={null}
      composer={null}
      {...(onPick ? { onPick } : {})}
    />
  </TContext.Provider>
);

/** The line numbers a Tab press can land on. */
const tabStops = () =>
  [...document.querySelectorAll<HTMLButtonElement>("table button")]
    .filter((b) => b.tabIndex === 0)
    .map((b) => b.getAttribute("aria-label"));

describe("diff-comment-keys: a diff line can be found and commented by keyboard (#1177)", () => {
  for (const [language, hint] of [
    ["en", "Click a line number to comment"],
    ["pt-BR", "Clique no número de uma linha para comentar"],
  ] as const) {
    test(`${language}: a line under the view says how to comment, only where comments are taken`, () => {
      render(view(language, () => {}));
      expect(screen.queryByText(new RegExp(hint))).not.toBeNull();
      cleanup();
      render(view(language));
      expect(screen.queryByText(new RegExp(hint)) === null).toBe(true);
    });
  }

  test("each file is one Tab stop: its first line number", () => {
    render(view("en", () => {}));
    expect(tabStops()).toEqual(["Comment on line 1 of a.ts", "Comment on line 1 of b.ts"]);
  });

  test("the arrows, Home and End move between a file's line numbers, and the Tab stop follows", () => {
    render(view("en", () => {}));
    const first = screen.getByRole("button", { name: "Comment on line 1 of a.ts" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    const at = () => document.activeElement?.getAttribute("aria-label") ?? "";
    const moves = [at()];
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    moves.push(at());
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    moves.push(at());
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    moves.push(at());
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    moves.push(at());
    expect(moves).toEqual([
      "Comment on line 2 of a.ts",
      "Comment on line 4 of a.ts",
      "Comment on line 4 of a.ts",
      "Comment on line 1 of a.ts",
      "Comment on line 1 of a.ts",
    ]);
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
    expect(tabStops()).toEqual(["Comment on line 2 of a.ts", "Comment on line 1 of b.ts"]);
  });
});
