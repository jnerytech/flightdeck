import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
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
const { EmptyState } = await import("../src/components/layout/states.tsx");
const { BoardColumnEmpty } = await import("../src/ui/BoardColumnEmpty.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(4000);

describe("estados-vazios", () => {
  test("an empty state is a soft surface, not a dashed box", () => {
    const { container } = render(<EmptyState title="Nenhum card" />);
    const box = container.firstElementChild as HTMLElement;
    expect(box.className).not.toContain("border-dashed");
    expect(box.className).toContain("bg-muted/30");
  });

  test("an empty board column offers a button that adds a card", () => {
    let added = 0;
    const { getByRole } = render(<BoardColumnEmpty label="Adicionar card" onAdd={() => added++} />);
    fireEvent.click(getByRole("button", { name: "Adicionar card" }));
    expect(added).toBe(1);
  });

  test("the hub's empty pane offers a new session on the first online host", async () => {
    const d = makeDaemon(cleanups);
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts[0]?.status === "online");
    await sidebar.openHub();
    const main = screen.queryByRole("main") as HTMLElement;
    await settle(
      () => within(main).queryByText("Escolha uma sessão para ver a conversa.") !== null,
    );
    // The list header has its own New session button; this one is the empty pane's.
    const button =
      within(main)
        .queryAllByRole("button", { name: "Nova sessão" })
        .find((b) => !b.closest('[data-slot="page-actions"]')) ?? null;
    expect(button).not.toBeNull();
    await act(async () => {
      fireEvent.click(button as HTMLElement);
    });
    const route = store.router.current;
    expect(route.name).toBe("new-session");
    expect(route.name === "new-session" ? route.host : "").toBe(
      store.getState().hosts[0]?.id ?? "",
    );
  });
});
