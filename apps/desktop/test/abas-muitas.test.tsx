import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { AppState } from "../src/lib/app-store.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const N = 25;
async function many() {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
  render(<App store={store} />);
  await act(async () => {
    for (let i = 0; i < N - 1; i++) store.tabs.open({ name: "session", host: "h", id: `s${i}` });
    (store as unknown as { update(patch: Partial<AppState>): void }).update({
      hosts: [
        {
          id: "h",
          name: "pc",
          status: "offline",
          sessions: [
            {
              id: "s0",
              cwd: "/p",
              status: "running",
              pendingPermissions: [
                { requestId: "r", toolName: "Bash", createdAt: "2026-11-03T10:00:00Z" },
              ],
            },
          ],
        },
      ] as never,
    });
  });
  const scroller = document.querySelector(".tab-scroller") as HTMLElement;
  return { store, scroller };
}

describe("abas-muitas: with many tabs the strip stays readable", () => {
  test("the tabs sit in a scroller and keep their width; a badge shrinks to a dot, still named", async () => {
    const { scroller } = await many();
    expect(scroller).not.toBeNull();
    expect(scroller.querySelectorAll(".tab-item")).toHaveLength(N);
    const badge = scroller.querySelector("[data-badge]") as HTMLElement;
    expect(badge.getAttribute("data-compact")).toBe("true");
    expect(badge.getAttribute("title")).toBe("Precisa de você");
    expect(badge.textContent).toBe("");
  });

  test("the wheel scrolls the strip sideways", async () => {
    const { scroller } = await many();
    await act(async () => {
      fireEvent.wheel(scroller, { deltaY: 120 });
    });
    expect(scroller.scrollLeft).toBe(120);
  });

  test("arrows appear when the strip overflows and scroll it", async () => {
    const { scroller } = await many();
    expect(screen.queryByRole("button", { name: "Rolar as abas para a direita" })).toBeNull();
    Object.defineProperty(scroller, "scrollWidth", { value: 2000, configurable: true });
    Object.defineProperty(scroller, "clientWidth", { value: 600, configurable: true });
    await act(async () => {
      fireEvent.scroll(scroller);
    });
    const right = screen.queryByRole("button", { name: "Rolar as abas para a direita" });
    expect(right).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Rolar as abas para a esquerda" })).toBeNull();
    await act(async () => {
      fireEvent.click(right as HTMLElement);
    });
    expect(scroller.scrollLeft).toBeGreaterThan(0);
  });

  test("the active tab scrolls into view", async () => {
    const seen: HTMLElement[] = [];
    (
      HTMLElement.prototype as unknown as { scrollIntoView: (this: HTMLElement) => void }
    ).scrollIntoView = function () {
      seen.push(this);
    };
    const { store } = await many();
    await act(async () => {
      store.tabs.activate(store.tabs.tabs[3]?.id as string);
    });
    expect(seen.at(-1)?.getAttribute("role")).toBe("tab");
    expect(seen.at(-1)?.getAttribute("aria-selected")).toBe("true");
  });

  test("a menu lists every tab and a click takes you to it", async () => {
    const { store } = await many();
    const button = screen.queryByRole("button", { name: "Todas as abas" }) as HTMLElement;
    expect(button).not.toBeNull();
    await act(async () => {
      fireEvent.pointerDown(button, { button: 0, ctrlKey: false, pointerType: "mouse" });
      fireEvent.click(button);
    });
    const items = screen.queryAllByRole("menuitem");
    expect(items).toHaveLength(N);
    await act(async () => {
      fireEvent.click(items[5] as HTMLElement);
    });
    expect(store.tabs.activeId).toBe(store.tabs.tabs[5]?.id as string);
  });

  test("with room to spare a working session shows its badge named, and it pulses", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(async () => {
      store.tabs.open({ name: "session", host: "h", id: "s0" });
      (store as unknown as { update(patch: Partial<AppState>): void }).update({
        hosts: [
          {
            id: "h",
            name: "pc",
            status: "offline",
            sessions: [{ id: "s0", cwd: "/p", status: "running", pendingPermissions: [] }],
          },
        ] as never,
      });
    });
    const badge = document.querySelector("[data-badge='running']") as HTMLElement;
    expect(badge.textContent).not.toBe("");
    expect(badge.className).toContain("animate-pulse");
    expect(badge.className).toContain("bg-muted");
  });
});
