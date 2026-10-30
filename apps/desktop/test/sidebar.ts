import { expect } from "bun:test";

/** What the helpers need from the test's own Testing Library (loaded after the DOM exists). */
interface Deps {
  act(callback: () => Promise<void>): Promise<unknown>;
  fireEvent: {
    click(element: Element): unknown;
    pointerDown(element: Element, init?: object): unknown;
    keyDown(element: Element, init?: object): unknown;
  };
  screen: { queryByRole(role: string, options?: object): HTMLElement | null };
}

/** The sidebar as the tests drive it: the nav, the host menus and the Precisa de você list. */
export function sidebarNav({ act, fireEvent, screen }: Deps) {
  const click = async (element: HTMLElement | null) => {
    expect(element).not.toBeNull();
    await act(async () => {
      fireEvent.click(element as HTMLElement);
    });
  };
  return {
    /** An item of a host's menu (Radix opens it on pointer down). */
    async hostAction(action: "Histórico" | "Projetos" | "Nova sessão", host = "alfa") {
      const trigger = screen.queryByRole("button", { name: `Menu de ${host}` });
      expect(trigger).not.toBeNull();
      await act(async () => {
        fireEvent.pointerDown(trigger as HTMLElement, { button: 0, ctrlKey: false });
        fireEvent.click(trigger as HTMLElement);
      });
      await click(screen.queryByRole("menuitem", { name: action }));
    },
    /** The names in a host's menu, which is closed again. */
    async hostMenuItems(host = "alfa") {
      const trigger = screen.queryByRole("button", { name: `Menu de ${host}` });
      expect(trigger).not.toBeNull();
      await act(async () => {
        fireEvent.pointerDown(trigger as HTMLElement, { button: 0, ctrlKey: false });
        fireEvent.click(trigger as HTMLElement);
      });
      const names = [...document.querySelectorAll("[role='menuitem']")].map((m) => m.textContent);
      await act(async () => {
        fireEvent.keyDown(document.querySelector("[role='menuitem']") as Element, {
          key: "Escape",
        });
      });
      return names;
    },
    /** The Precisa de você screen. */
    async openQueue() {
      await click(screen.queryByRole("button", { name: /^Precisa de você/ }));
    },
    /** A request of the queue: opens its screen and chooses it, so its card shows on the right. */
    async queueItem(label: string | RegExp) {
      await click(screen.queryByRole("button", { name: /^Precisa de você/ }));
      await click(screen.queryByRole("button", { name: label }));
    },
    /** The Sessões screen. */
    async openHub() {
      await click(screen.queryByRole("button", { name: "Abrir Sessões" }));
    },
  };
}
