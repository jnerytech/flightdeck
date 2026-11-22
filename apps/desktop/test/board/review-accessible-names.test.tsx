import { afterEach, describe, expect, test } from "bun:test";
import { translator } from "../../src/i18n/index.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { fakeHostStore } from "../fake-host.ts";
import { uiIdle } from "../wait.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { DiffView } = await import("../../src/features/review/diff-view.tsx");
const { PrComments } = await import("../../src/features/review/pr-comments.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

afterEach(cleanup);

/**
 * #3892 (#168): a screen reader lists the tables and the checkboxes of the Review screen by name.
 * A diff table had none, and every PR comment checkbox said only the author, so two comments by
 * one person were the same control.
 */
const file = (path: string) =>
  ({
    path,
    oldPath: null,
    status: "modified",
    additions: 1,
    deletions: 0,
    uncommitted: true,
    binary: false,
    tooLarge: false,
    hunks: [{ header: "@@ -0,0 +1,1 @@", lines: [{ op: "+", text: "line 1" }] }],
  }) as never;

const diff = (language: "en" | "pt-BR", mode: "unified" | "split") => (
  <TContext.Provider value={translator(language)}>
    <DiffView
      files={[file("a.ts"), file("b.ts")]}
      mode={mode}
      selection={null}
      composer={null}
      onPick={() => {}}
    />
  </TContext.Provider>
);

describe("review-accessible-names: the diff tables", () => {
  test.each([
    ["en", "unified", ["Changes in a.ts", "Changes in b.ts"]],
    ["en", "split", ["Changes in a.ts", "Changes in b.ts"]],
    ["pt-BR", "unified", ["Alterações em a.ts", "Alterações em b.ts"]],
    ["pt-BR", "split", ["Alterações em a.ts", "Alterações em b.ts"]],
  ] as const)("%s, %s: each file's table is named with its path", (language, mode, names) => {
    render(diff(language, mode));
    expect(screen.queryAllByRole("table").map((table) => table.getAttribute("aria-label"))).toEqual(
      [...names],
    );
  });
});

describe("review-accessible-names: the PR comment checkboxes", () => {
  const comments = [
    { id: "k1", author: "ana", body: "rename", resolved: false, path: "app.ts", line: 12 },
    { id: "k2", author: "ana", body: "and this", resolved: false, path: "app.ts", line: 40 },
    { id: "k3", author: "ana", body: "overall", resolved: false, path: null },
  ];
  const names = async (language: "en" | "pt-BR") => {
    const { store } = await fakeHostStore({}, { fallback: { comments } });
    render(
      <TContext.Provider value={translator(language)}>
        <PrComments store={store} hostId="h" cardId="c1" moment="m" />
      </TContext.Provider>,
    );
    await uiIdle();
    return screen.queryAllByRole("checkbox").map((box) => box.getAttribute("aria-label"));
  };

  test("two comments by one author differ by file and line, and one on the whole review says so", async () => {
    expect(await names("en")).toEqual([
      "Select the comment by ana on app.ts:12",
      "Select the comment by ana on app.ts:40",
      "Select the comment by ana on review",
    ]);
  });

  test("pt-BR says the same in Portuguese", async () => {
    expect(await names("pt-BR")).toEqual([
      "Selecionar o comentário de ana em app.ts:12",
      "Selecionar o comentário de ana em app.ts:40",
      "Selecionar o comentário de ana em revisão",
    ]);
  });
});
