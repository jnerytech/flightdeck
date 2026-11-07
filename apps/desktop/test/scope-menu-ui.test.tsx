import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { ScopeMenu } = await import("../src/components/shell/scope-menu.tsx");

afterEach(cleanup);

// #126 slice 4: a project the screen does not list still reads as a project's name, never its key.
describe("scope-menu: the name of a project scope", () => {
  test("a project missing from the screen's list reads as its label, not its raw key", () => {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    render(
      <ScopeMenu
        store={store}
        hosts={[{ id: "h1", name: "alfa" }]}
        projects={[]}
        scope={{ kind: "project", projectKey: "host:alfa:/work/app" }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Data from app" }) !== null).toBe(true);
  });
});
