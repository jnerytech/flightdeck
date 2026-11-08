import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Server } from "lucide-react";
import { seedDemoHosts } from "../src/demo/boot.ts";
import { translator } from "../src/i18n/index.ts";
import { hostColorVar } from "../src/lib/host-color.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { TopBarHost } = await import("../src/components/shell/top-bar.tsx");
const { TabOverflow } = await import("../src/components/tabs/tab-overflow.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

/** The color a dot paints: the CSS value of its background. */
const paint = (dot: Element | null) => (dot as HTMLElement | null)?.style.backgroundColor ?? "";

describe("host-color-ui: a host's color shows where its name does (issue #644)", () => {
  test("the switcher's button and each host of its menu carry the host's dot, beside the name", async () => {
    const hosts = [
      { id: "ha", name: "alfa", status: "online" as const },
      { id: "hb", name: "beta", status: "offline" as const },
    ];
    render(
      <TopBarHost
        hosts={hosts}
        currentId="ha"
        t={translator("en")}
        onChoose={() => undefined}
        onAdd={() => undefined}
      />,
    );
    const button = screen.queryByRole("button", { name: "Host: alfa" }) as HTMLElement;
    expect(paint(button.querySelector("[data-host-dot]"))).toBe(hostColorVar("ha"));
    // The name stays: the color is never the only sign.
    expect(button.textContent).toContain("alfa");
    await act(async () => {
      fireEvent.pointerDown(button, { button: 0, ctrlKey: false, pointerType: "mouse" });
      fireEvent.click(button);
    });
    const items = screen.queryAllByRole("menuitemradio");
    const painted = items.map((item) => paint(item.querySelector("[data-host-dot]")));
    expect(painted).toEqual([hostColorVar("ha"), hostColorVar("hb")]);
  });

  test("the list of all tabs puts the host's dot before its name, and none on a shared screen", async () => {
    render(
      <TabOverflow
        t={translator("en")}
        rows={[
          {
            id: "1",
            title: "Board",
            host: "alfa",
            hostId: "ha",
            icon: Server,
            kind: "board",
            current: true,
            pinned: false,
          },
          {
            id: "2",
            title: "Settings",
            host: "",
            icon: Server,
            kind: "settings",
            current: false,
            pinned: true,
          },
        ]}
        onPick={() => undefined}
        onClose={() => undefined}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "All tabs" }) as HTMLElement);
    });
    const [board, settings] = screen.queryAllByRole("option");
    expect(paint(board?.querySelector("[data-host-dot]") ?? null)).toBe(hostColorVar("ha"));
    expect(settings?.querySelector("[data-host-dot]") === null).toBe(true); // NOSONAR: the boolean keeps a DOM node out of the failure diff
  });

  test("a host tab's strip item holds its host's color; a shared tab's holds none", async () => {
    const mem = memoryPlatform(false, "en");
    seedDemoHosts(mem.win.localStorage, mem.tokens, [
      { id: "ha", name: "alfa", url: "ws://127.0.0.1:1", token: "t" },
    ]);
    const store = new AppStore(mem.platform, { baseDelayMs: 600_000 });
    render(<App store={store} />);
    await act(async () => {
      store.hostTabs.open({ name: "history", host: "ha" });
    });
    const row = screen.queryByRole("tablist", { name: "Tabs" }) as HTMLElement;
    const items = [...row.querySelectorAll<HTMLElement>(".tab-item")];
    const colors = items.map((item) => item.style.getPropertyValue("--host-color"));
    // Sessions is the shared tab; alfa's Overview (opened on its own) and History are the host's.
    expect(colors[0]).toBe("");
    expect(colors.slice(1).every((c) => c === hostColorVar("ha"))).toBe(true);
    expect(colors.length).toBeGreaterThan(1);
    expect(items.slice(1).every((item) => item.hasAttribute("data-host"))).toBe(true);
    expect(items[0]?.hasAttribute("data-host")).toBe(false);
  });
});
