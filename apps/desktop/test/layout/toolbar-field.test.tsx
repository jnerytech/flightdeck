import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { readStyles } from "../../../../scripts/lib/styles/styles-source.ts";
import { registerDom } from "../dom.ts";
import { memoryPlatform } from "../fixtures.ts";

registerDom();
const { cleanup, render, screen } = await import("@testing-library/react");
const { AppStore } = await import("../../src/lib/app-store.ts");
const { SessionsHub } = await import("../../src/features/sessions/sessions-hub.tsx");
const { TooltipProvider } = await import("../../src/components/ui/tooltip.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const css = readStyles(join(import.meta.dir, "../../src/styles.css"));

/** The body of one `@utility` block. */
function utility(name: string): string {
  const start = css.indexOf(`@utility ${name} {`);
  if (start < 0) return "";
  return css.slice(start, css.indexOf("}", start) + 1);
}

function hubFilterField(): HTMLElement {
  const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
  store.i18n.start();
  render(
    <TooltipProvider>
      <SessionsHub
        store={store}
        state={store.getState()}
        onOpen={() => {}}
        isOpen={() => false}
        density="comfortable"
      />
    </TooltipProvider>,
  );
  return screen.getByLabelText("Filter sessions");
}

// Issue #2821: beside an open session the Sessions hub list is about 340 px wide. The filter field
// was `min-w-0 flex-1`, with a flex basis of 0, so it shrank to about 40 px and showed "Fil" while
// the toolbar never wrapped. A field in a toolbar keeps a usable width and wraps instead.
describe("toolbar-field: a filter field in a toolbar keeps a usable width", () => {
  test("the utility grows from a basis of 8rem, so the toolbar wraps before the field shrinks", () => {
    expect(/flex:\s*1 1 8rem/.test(utility("toolbar-field"))).toBe(true);
  });

  test("the Sessions hub filter field keeps a floor of 8rem: the Input's own min-w-0 is replaced", () => {
    const classes = hubFilterField().className.split(" ");
    expect(classes.includes("toolbar-field")).toBe(true);
    expect(classes.includes("min-w-32")).toBe(true);
    expect(classes.includes("min-w-0")).toBe(false);
  });
});
