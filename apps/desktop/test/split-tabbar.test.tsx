import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

afterEach(cleanup);

const css = readFileSync(resolve(import.meta.dir, "../src/styles.css"), "utf8");

/** The `flex` a named style of styles.css sets, or null when it sets none. */
function flexOf(utility: string): string | null {
  const start = css.indexOf(`@utility ${utility} {`);
  if (start < 0) return null;
  const body = css.slice(start, css.indexOf("\n}", start));
  return /\n\s*flex:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? null;
}

describe("split-tabbar: a split area's tab bar keeps its height", () => {
  // Issue #225: in a split, the tab bar sat in the area's column with flex 1 1 auto and took about
  // half of it (394 px), the tabs at its bottom over an empty band.
  test("a tab bar does not grow by itself; only the header's slot lets its bar fill the row", () => {
    expect(flexOf("tab-bar")).toBe("none");
    const start = css.indexOf("@utility header-tabs {");
    const header = css.slice(start, css.indexOf("\n}", start));
    expect(/& > \.tab-bar \{\s*flex: 1 1 auto;/.test(header)).toBe(true);
  });

  test("in one area the bar sits in the header's slot; in a split each area holds its own", async () => {
    const store = new AppStore(memoryPlatform(false, "en").platform);
    render(<App store={store} />);
    expect(document.querySelectorAll(".header-tabs > .tab-bar")).toHaveLength(1);
    await act(async () => {
      fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    });
    expect(document.querySelectorAll("section[aria-label] > .tab-bar")).toHaveLength(2);
    expect(document.querySelectorAll(".header-tabs > .tab-bar")).toHaveLength(0);
  });
});
