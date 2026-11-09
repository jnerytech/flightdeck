import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TContext } = await import("../src/i18n/context.tsx");
const { ReviewList } = await import("../src/ui/ReviewList.tsx");

afterEach(cleanup);

/**
 * #1497: a comment on a blank changed line quoted that line as an empty grey bar, which read as a
 * box that failed to load. The quote now says the line is blank, in words, in both languages.
 */
const comment = (over: object = {}) => ({
  id: "c1",
  path: "fake-1.txt",
  side: "new",
  lineStart: 2,
  lineEnd: 2,
  quote: "",
  body: "Drop the blank line.",
  state: "draft",
  outdated: false,
  author: "reviewer",
  severity: "low",
  ...over,
});

function list(comments: object[], language: "en" | "pt-BR" = "en") {
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  render(
    <TContext.Provider value={store.i18n.t}>
      <ReviewList
        comments={comments as never}
        onUpdate={() => {}}
        onRemove={() => {}}
        onSend={() => {}}
      />
    </TContext.Provider>,
  );
}

/** What each comment shows as its quote: the code block's text, or null when there is none. */
const quotes = () =>
  screen.queryAllByRole("listitem").map((item) => item.querySelector("pre")?.textContent ?? null);

describe("review-list-ui: the quote of a blank line (#1497)", () => {
  test("a comment on a blank line says so in words and shows no empty code block", () => {
    list([comment(), comment({ id: "c2", lineEnd: 3, quote: "  \n" })]);
    const items = screen.queryAllByRole("listitem");
    expect([
      items[0]?.textContent?.includes("(blank line)"),
      items[1]?.textContent?.includes("(blank lines)"),
      quotes(),
    ]).toEqual([true, true, [null, null]]);
  });

  test("in pt-BR, the blank line is named in Portuguese", () => {
    list([comment()], "pt-BR");
    const item = screen.queryAllByRole("listitem")[0];
    expect(item?.textContent?.includes("(linha em branco)")).toBe(true);
  });

  test("a line with text keeps its quote as code", () => {
    list([comment({ quote: "total += price" })]);
    expect(quotes()).toEqual(["total += price"]);
  });
});
