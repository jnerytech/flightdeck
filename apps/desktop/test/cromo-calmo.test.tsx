import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { activeNav } from "../src/lib/nav-active.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(4000);
const css = readFileSync(resolve(import.meta.dir, "../src/styles.css"), "utf8");

/** The value of a token inside the first `selector { … }` block. */
function token(selector: string, name: string): string {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return new RegExp(`${name}:\\s*([^;]+);`).exec(body)?.[1]?.trim() ?? "";
}

describe("cromo-calmo", () => {
  test("a route maps to the sidebar item it belongs to", () => {
    expect(activeNav({ name: "hub" })).toBe("sessions");
    expect(activeNav({ name: "session", host: "h", id: "s" })).toBe("sessions");
    expect(activeNav({ name: "new-session", host: "h" })).toBe("sessions");
    expect(activeNav({ name: "needs-you" })).toBe("needs-you");
    expect(activeNav({ name: "board", host: "h", projectId: "p" })).toBe("board");
    expect(activeNav({ name: "costs" })).toBe("costs");
    expect(activeNav({ name: "settings" })).toBe("settings");
    expect(activeNav({ name: "terminal", host: "h", id: "t" } as never)).toBeNull();
  });

  test("the bar dims its items and marks the open one at full contrast", async () => {
    const d = makeDaemon(cleanups);
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    await sidebar.openHub();
    const open = screen.queryByRole("button", { name: "Abrir Sessões" });
    expect(open?.getAttribute("aria-current")).toBe("page");
    expect(open?.className).not.toContain("text-sidebar-foreground/70");
    const other = screen.queryByRole("button", { name: "Precisa de você" });
    expect(other?.getAttribute("aria-current")).toBeNull();
    expect(other?.className).toContain("text-sidebar-foreground/70");
  });

  test("borders and separators are softer than before, in both themes", () => {
    for (const selector of [":root", ".dark"]) {
      for (const name of ["--border", "--sidebar-border"]) {
        const alpha = Number(/\/\s*(\d+)%/.exec(token(selector, name))?.[1]);
        expect(alpha).toBeLessThanOrEqual(6);
      }
    }
  });
});
