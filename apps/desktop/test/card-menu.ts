import { expect } from "bun:test";
import { settle } from "./wait.ts";

/** What the helper needs from a test's own Testing Library import. */
interface Kit {
  act(run: () => Promise<void>): Promise<unknown>;
  fireEvent: {
    pointerDown(el: Element, init: object): unknown;
    click(el: Element): unknown;
  };
  screen: {
    queryByRole(role: string, options?: { name?: string | RegExp }): HTMLElement | null;
  };
}

/**
 * Chooses an item of the card page's menu (#1197: Finish…, Discard, Start in the background and
 * the other ways to start sit under it). `label` is the menu button's name, "Actions for <title>"
 * or "Ações de <title>".
 */
export async function chooseFromCardMenu(kit: Kit, label: string, item: string | RegExp) {
  const trigger = kit.screen.queryByRole("button", { name: label });
  expect(trigger).not.toBeNull();
  await kit.act(async () => {
    if (trigger) {
      kit.fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    }
  });
  await settle(() => kit.screen.queryByRole("menuitem", { name: item }) !== null);
  const entry = kit.screen.queryByRole("menuitem", { name: item });
  expect(entry).not.toBeNull();
  await kit.act(async () => {
    if (entry) kit.fireEvent.click(entry);
  });
}
