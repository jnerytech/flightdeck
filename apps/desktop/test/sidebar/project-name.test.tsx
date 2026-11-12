import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readStyles } from "../../../../scripts/lib/styles-source.ts";
import type { TreeProject } from "../../src/features/projects/project-tree-model.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { ProjectTree } = await import("../../src/features/projects/project-tree.tsx");
const { TContext } = await import("../../src/i18n/context.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/**
 * Issue #1550: a project name too long for the side bar is cut with an ellipsis on one line,
 * left-aligned like the other rows, with the full name in the tooltip and the accessible name.
 */

const LONG = "loja-en-1280-1794214757097";

const tree: TreeProject[] = [
  { hostId: "h1", projectId: "p1", name: LONG, path: "/work/loja", nodes: [] },
];

function setup() {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  return (
    <TContext.Provider value={store.i18n.t}>
      <ProjectTree store={store} tree={tree} filter={null} t={store.i18n.t} go={() => {}} />
    </TContext.Provider>
  );
}

describe("sidebar-project-name: a long project name stays on one line (issue #1550)", () => {
  test("the name is its own element, and the button carries the full name as its tooltip", () => {
    render(setup());
    const button = screen.queryByRole("button", { name: LONG });
    expect(button).not.toBeNull();
    expect(button?.getAttribute("title")).toBe(LONG);
    const label = button?.querySelector(".project-tree-label");
    expect(label?.textContent).toBe(LONG);
  });

  test("that element shrinks, is cut with an ellipsis on one line, and reads from the left", async () => {
    const css = readStyles(new URL("../../src/styles.css", import.meta.url));
    const rule = css.split("@utility project-tree-label")[1]?.split("@utility")[0] ?? "";
    for (const line of [
      "min-width: 0;",
      "overflow: hidden;",
      "text-overflow: ellipsis;",
      "white-space: nowrap;",
      "text-align: left;",
    ]) {
      expect(`${line} ${rule.includes(line)}`).toBe(`${line} true`);
    }
  });
});
