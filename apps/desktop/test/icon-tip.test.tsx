import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { settle } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { IconTip } = await import("../src/components/feedback/icon-tip.tsx");
const { AppStore } = await import("../src/lib/app-store.ts");
const { Sidebar } = await import("../src/ui/Sidebar.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

describe("icon-tip: a tooltip names an icon-only control, never a native title (issue #165)", () => {
  test("hovering shows the label in a real tooltip; the control keeps no title", async () => {
    render(
      <IconTip label="Sessions">
        <button type="button" aria-label="Open Sessions">
          S
        </button>
      </IconTip>,
    );
    const button = screen.getByRole("button", { name: "Open Sessions" });
    expect(button.getAttribute("title")).toBeNull();
    await act(async () => {
      fireEvent.pointerMove(button, { pointerType: "mouse" });
    });
    await settle(() => screen.queryByRole("tooltip") !== null, 3000, "the tooltip opens");
    expect(screen.getByRole("tooltip").textContent).toBe("Sessions");
  });

  test("keyboard focus shows it too", async () => {
    render(
      <IconTip label="Sessions">
        <button type="button">S</button>
      </IconTip>,
    );
    await act(async () => {
      fireEvent.focus(screen.getByRole("button"));
    });
    await settle(() => screen.queryByRole("tooltip") !== null, 3000, "the tooltip opens");
  });

  test("with no label it adds nothing around the control", () => {
    render(
      <IconTip label={undefined}>
        <button type="button">S</button>
      </IconTip>,
    );
    fireEvent.pointerMove(screen.getByRole("button"), { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("icon-tip: the narrow sidebar uses it (issue #165)", () => {
  function rail() {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    render(
      <Sidebar
        store={store}
        state={store.getState()}
        collapsed
        t={store.i18n.t}
        go={() => {}}
        onOpenProjectScreen={() => {}}
        onNewSession={() => {}}
        onRemoveHost={() => {}}
        onRenameHost={() => null}
        onOpenSearch={() => {}}
        onNewTab={() => {}}
        onToggleTheme={() => {}}
      />,
    );
  }

  test("an item of the rail has no native title, and its name shows in a tooltip", async () => {
    rail();
    const item = screen.getByRole("button", { name: "Open Sessions" });
    expect(item.getAttribute("title")).toBeNull();
    await act(async () => {
      fireEvent.pointerMove(item, { pointerType: "mouse" });
    });
    await settle(() => screen.queryByRole("tooltip") !== null, 3000, "the tooltip opens");
    expect(screen.getByRole("tooltip").textContent).toBe("Sessions");
  });

  test("the expanded bar shows no tooltip on a labelled item", async () => {
    const store = new AppStore(memoryPlatform(false, "en").platform, { baseDelayMs: 600_000 });
    store.i18n.start();
    render(
      <Sidebar
        store={store}
        state={store.getState()}
        collapsed={false}
        t={store.i18n.t}
        go={() => {}}
        onOpenProjectScreen={() => {}}
        onNewSession={() => {}}
        onRemoveHost={() => {}}
        onRenameHost={() => null}
        onOpenSearch={() => {}}
        onNewTab={() => {}}
        onToggleTheme={() => {}}
      />,
    );
    const item = screen.getByRole("button", { name: "Open Sessions" });
    fireEvent.pointerMove(item, { pointerType: "mouse" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(item.getAttribute("title")).toBeNull();
  });
});

describe("icon-tip: the client switcher keeps its title only as a tooltip in the rail (issue #165)", () => {
  test("its source has no native title", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/components/clients/client-switcher.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/\btitle=\{/);
    expect(source).toContain("<IconTip");
  });
});
