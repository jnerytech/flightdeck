import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { memoriaHost } from "./memoria-ui-setup.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { HostsBanner } = await import("../src/components/hosts/hosts-banner.tsx");
const { DiffView } = await import("../src/ui/DiffView.tsx");

setDefaultTimeout(20_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The pointer targets of WCAG 2.5.8 are at least 24 px: `min-h-6` is 1.5 rem at the root size. */
const tall = (el: Element | null) => (el?.className ?? "").split(" ").includes("min-h-6");

describe("alvos: raw buttons keep a 24 px target", () => {
  test("the sidebar's section titles are 24 px tall", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(<App store={store} />);
    await act(() => Bun.sleep(20));
    const titles = screen
      .queryAllByRole("button")
      .filter((b) => b.hasAttribute("aria-expanded") && b.className.includes("uppercase"));
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) expect(tall(title)).toBe(true);
  });

  test("the hosts banner's toggle is 24 px tall", () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    const host = (id: string, status: string) => ({ id, name: id, status }) as never;
    render(<HostsBanner hosts={[host("caiu", "offline")]} t={store.i18n.t} />);
    expect(tall(screen.queryByRole("button", { name: "1 host com problema" }))).toBe(true);
  });

  test("the diff's line-number buttons are 24 px tall, so the rows of a diff do not share a smaller target", () => {
    const file = {
      path: "a.ts",
      oldPath: null,
      status: "modified",
      additions: 2,
      deletions: 1,
      uncommitted: false,
      binary: false,
      hunks: [
        {
          header: "@@ -1,2 +1,3 @@",
          lines: [
            { op: " ", text: "um" },
            { op: "-", text: "dois" },
            { op: "+", text: "2" },
            { op: "+", text: "tres" },
          ],
        },
      ],
    };
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform);
    render(
      <DiffView
        files={[file] as never}
        mode="unified"
        selection={null}
        onPick={() => {}}
        composer={null}
      />,
    );
    const numbers = screen.queryAllByRole("button");
    expect(numbers.length).toBeGreaterThanOrEqual(3);
    for (const number of numbers) expect(tall(number)).toBe(true);
    store.dispose();
  });

  test("the memory files' title buttons are 24 px tall", async () => {
    const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    const h = await memoriaHost(cleanups, store);
    h.put("MEMORY.md", "- [Papel](user_role.md) — quem é o usuário\n");
    h.put("user_role.md", "---\nname: papel\ndescription: x\ntype: user\n---\nÉ engenheiro.\n");
    render(<App store={store} />);
    const wait = async (check: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!check() && Date.now() < deadline) await act(() => Bun.sleep(15));
    };
    await wait(() => store.getState().hosts[0]?.hostInfo?.features?.includes("memory") === true);
    await act(async () => {
      store.router.push({
        name: "agent",
        host: h.hostId,
        projectId: h.projectId,
        projectName: "repo",
      });
    });
    await wait(() => screen.queryByRole("tab", { name: "Memória" }) !== null);
    const tab = screen.queryByRole("tab", { name: "Memória" });
    await act(async () => {
      fireEvent.mouseDown(tab as HTMLElement, { button: 0 });
    });
    await wait(() => screen.queryByRole("button", { name: "Abrir MEMORY.md" }) !== null);
    const titles = screen.queryAllByRole("button", { name: /^Abrir .+\.md$/ });
    expect(titles.length).toBeGreaterThanOrEqual(2);
    for (const title of titles) expect(tall(title)).toBe(true);
  });
});
