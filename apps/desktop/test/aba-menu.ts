import { expect } from "bun:test";

/** What the helpers need from the test's own Testing Library (loaded after the DOM exists). */
interface Deps {
  act(callback: () => Promise<void>): Promise<unknown>;
  fireEvent: {
    click(element: Element): unknown;
    pointerDown(element: Element, init?: object): unknown;
  };
  screen: { queryByRole(role: string, options?: object): HTMLElement | null };
}

/** The active tab's actions menu (Radix opens it on pointer down), and an item chosen from it. */
export function tabMenu({ act, fireEvent, screen }: Deps) {
  const open = async (title: string) => {
    const trigger = screen.queryByRole("button", { name: `Ações da aba ${title}` });
    expect(trigger).not.toBeNull();
    await act(async () => {
      fireEvent.pointerDown(trigger as HTMLElement, { button: 0, ctrlKey: false });
      fireEvent.click(trigger as HTMLElement);
    });
  };
  return {
    open,
    item: (name: string) => screen.queryByRole("menuitem", { name }),
    /** Opens the menu of the tab `title` and picks `name`. */
    async choose(title: string, name: string) {
      await open(title);
      const item = screen.queryByRole("menuitem", { name });
      expect(item).not.toBeNull();
      await act(async () => {
        fireEvent.click(item as HTMLElement);
      });
    },
  };
}
