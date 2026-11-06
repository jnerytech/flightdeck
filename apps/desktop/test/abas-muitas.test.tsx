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

/** Many tabs, one with a long title, and the list of all of them open. */
async function openList() {
  const { store } = await many();
  await act(async () => {
    store.tabs.open(
      {
        name: "preview",
        url: "https://example.com/a/very/long/path/of/a/deploy/report",
        title: "Relatório do deploy de ontem à noite, com todos os passos e a saída inteira",
      },
      { background: true },
    );
  });
  const button = screen.queryByRole("button", { name: "Todas as abas" }) as HTMLElement;
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.pointerDown(button, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(button);
  });
  return { store };
}

describe("abas-muitas: with many tabs the strip stays readable", () => {
  test("the tabs sit in a scroller and keep their width; a badge is a glyph, still named", async () => {
    const { scroller } = await many();
    expect(scroller).not.toBeNull();
    expect(scroller.querySelectorAll(".tab-item")).toHaveLength(N);
    const badge = scroller.querySelector("[data-badge]") as HTMLElement;
    expect(badge.getAttribute("role")).toBe("img");
    expect(badge.getAttribute("aria-label")).toBe("Precisa de você");
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
    // Once scrolled right, the left arrow shows and takes the strip back.
    const away = scroller.scrollLeft;
    const left = screen.queryByRole("button", { name: "Rolar as abas para a esquerda" });
    expect(left).not.toBeNull();
    await act(async () => {
      fireEvent.click(left as HTMLElement);
    });
    expect(scroller.scrollLeft).toBeLessThan(away);
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

  test("the list of all tabs is a filterable list, not a menu: icon, title, host, the active one marked (#576)", async () => {
    const { store } = await openList();
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
    const field = screen.queryByRole("combobox", { name: "Filtrar abas" });
    expect(field).not.toBeNull();
    const rows = screen.queryAllByRole("option");
    expect(rows).toHaveLength(N + 1);
    expect(rows.every((row) => row.querySelector("svg[data-icon]") !== null)).toBe(true);
    // The tab on screen is marked for a screen reader, and only it.
    const current = rows.filter((row) => row.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0]?.id).toContain(store.tabs.activeId);
    // A session row names its host in muted text; the full title is the row's tooltip.
    const first = rows[1] as HTMLElement;
    expect(first.querySelector("[data-slot='tab-host']")?.textContent).toBe("pc");
    const label = first.querySelector("[data-slot='tab-title']");
    expect(label?.getAttribute("title")).toBe(label?.textContent ?? "");
  });

  test("typing filters the tabs and Enter goes to the first one left (#576)", async () => {
    const { store } = await openList();
    const field = screen.queryByRole("combobox", { name: "Filtrar abas" }) as HTMLElement;
    expect(field).not.toBeNull();
    await act(async () => {
      fireEvent.change(field, { target: { value: "deploy" } });
    });
    const rows = screen.queryAllByRole("option");
    expect(rows).toHaveLength(1);
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(store.tabs.active.router.current.name).toBe("preview");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("a row's close button and Delete on the highlighted row close that tab; the list stays (#576)", async () => {
    const { store } = await openList();
    const rows = screen.queryAllByRole("option");
    const close = rows[2]?.querySelector<HTMLElement>("button[data-slot='tab-close']") ?? null;
    expect(close).not.toBeNull();
    await act(async () => {
      fireEvent.click(close as HTMLElement);
    });
    expect(store.tabs.tabs).toHaveLength(N);
    expect(screen.queryAllByRole("option")).toHaveLength(N);
    const field = screen.queryByRole("combobox", { name: "Filtrar abas" }) as HTMLElement;
    expect(field).not.toBeNull();
    const before = store.tabs.tabs.length;
    await act(async () => {
      fireEvent.keyDown(field, { key: "Home" });
      fireEvent.keyDown(field, { key: "ArrowDown" });
      fireEvent.keyDown(field, { key: "Delete" });
    });
    expect(store.tabs.tabs).toHaveLength(before - 1);
    expect(screen.queryByRole("listbox")).not.toBeNull();
  });

  test("Esc closes the list (#576)", async () => {
    await openList();
    const field = screen.queryByRole("combobox", { name: "Filtrar abas" }) as HTMLElement;
    expect(field).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown(field, { key: "Escape" });
    });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("a working session's badge is named and spins (only where motion is allowed)", async () => {
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
    expect(badge.getAttribute("aria-label")).toBe("Rodando");
    expect(badge.className).toContain("motion-safe:animate-spin");
    expect(badge.className).toContain("text-muted-foreground");
  });
});
