import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { GlobalSearch } = await import("../src/ui/GlobalSearch.tsx");

afterEach(cleanup);

const LONG_PATH = `C:\\Users\\someone\\Documents\\clients\\acme\\${"deeply-nested-folder-".repeat(6)}final`;
const LONG_SNIPPET = `the «flamingo» ${"and a very long line of text that never breaks ".repeat(8)}`;

/** The palette next to a button that opened it, with every callback recorded. */
function mount(withHit = false) {
  const store = new AppStore(memoryPlatform().platform);
  const closed: number[] = [];
  const base = store.getState();
  const state = withHit
    ? {
        ...base,
        search: {
          query: "flamingo",
          waiting: [],
          silent: [],
          hits: [
            {
              hostId: "h1",
              hostName: "alfa",
              claudeSessionId: "s1",
              uuid: "u1",
              ts: "2026-09-01T10:00:00.000Z",
              cwd: LONG_PATH,
              title: null,
              role: "user",
              snippet: LONG_SNIPPET,
              cursor: "c1",
            },
          ],
        },
      }
    : base;
  const palette = (
    <GlobalSearch
      state={state}
      store={store}
      costs={false}
      onSearch={() => {}}
      onClose={() => closed.push(closed.length)}
      onOpenHit={() => {}}
      onGo={() => {}}
    />
  );
  const view = render(
    <div>
      <button type="button">Opener</button>
      <p>The page behind</p>
    </div>,
  );
  const opener = screen.queryByRole("button", { name: "Opener" }) as HTMLButtonElement;
  opener.focus();
  view.rerender(
    <div>
      <button type="button">Opener</button>
      <p>The page behind</p>
      {palette}
    </div>,
  );
  return { closed, opener };
}

const input = () => screen.queryByLabelText("Buscar no histórico") as HTMLInputElement;

describe("busca-global-fecha: the global search leaves when the person asks it to (issue #566)", () => {
  test("Esc in the field closes it and gives the focus back to what opened it", async () => {
    const { closed, opener } = mount();
    expect(document.activeElement === input()).toBe(true);
    await act(async () => {
      fireEvent.keyDown(input(), { key: "Escape" });
    });
    expect(closed).toHaveLength(1);
    expect(document.activeElement === opener).toBe(true);
  });

  test("Esc closes it even with the focus outside, on the page behind", async () => {
    const { closed, opener } = mount();
    await act(async () => {
      opener.focus();
      fireEvent.keyDown(opener, { key: "Escape" });
    });
    expect(closed).toHaveLength(1);
    expect(document.activeElement === opener).toBe(true);
  });

  test("a click outside closes it; a click inside does not", async () => {
    const { closed, opener } = mount();
    await act(async () => {
      fireEvent.pointerDown(input());
      fireEvent.pointerDown(screen.queryByRole("dialog") as HTMLElement);
    });
    expect(closed).toHaveLength(0);
    await act(async () => {
      fireEvent.pointerDown(screen.queryByText("The page behind") as HTMLElement);
    });
    expect(closed).toHaveLength(1);
    expect(document.activeElement === opener).toBe(true);
  });

  test("a long row truncates with an ellipsis and keeps its full text in a title, so the list never scrolls sideways", () => {
    mount(true);
    const row = within(screen.queryByRole("list", { name: "Resultados da busca" }) as HTMLElement)
      .queryAllByRole("button")
      .at(0) as HTMLElement;
    expect(row).not.toBeUndefined();
    expect(row.className.split(" ").includes("min-w-0")).toBe(true);
    const lines = [...row.children] as HTMLElement[];
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.className.split(" ").includes("truncate")).toBe(true);
      expect((line.getAttribute("title") ?? "").length).toBeGreaterThan(0);
    }
    expect(lines[0]?.getAttribute("title")).toContain(LONG_PATH);
    expect(lines[1]?.getAttribute("title")).toBe(LONG_SNIPPET.replaceAll(/[«»]/g, ""));
    // The window itself clips what is left over instead of offering a sideways scroll.
    expect((screen.queryByRole("dialog") as HTMLElement).className).toContain("overflow-x-hidden");
  });
});
