import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { legacyDaemon } from "../legacy-daemon.ts";
import { uiIdle, waiter } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { VaultPage } = await import("../../src/features/vault/page.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
const scrolled: Element[] = [];
const realScroll = Element.prototype.scrollIntoView;
Element.prototype.scrollIntoView = function (this: Element) {
  scrolled.push(this);
};
afterEach(async () => {
  cleanup();
  scrolled.length = 0;
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
process.on("exit", () => {
  Element.prototype.scrollIntoView = realScroll;
});

const settle = waiter(4000);

/** The page over a store with one secret named "deploy". */
async function open() {
  const { platform } = memoryPlatform();
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  const daemon = legacyDaemon(cleanups);
  await store.roster.add({ name: "box", url: daemon.url, token: TOKEN });
  await store.secrets.add({ name: "deploy", type: "password", value: "panel-focus-value-0123" });
  render(<VaultPage store={store} />);
  await settle(() => screen.queryByRole("button", { name: "Editar deploy" }) !== null);
}

const button = (name: string) => screen.queryByRole("button", { name }) as HTMLElement;
const click = async (name: string) => {
  expect(screen.queryByRole("button", { name }) === null).toBe(false);
  await act(async () => {
    fireEvent.click(button(name));
  });
  await uiIdle();
};
/** True when the focus is on `el`; a failed `toBe` on a DOM node would dump the whole tree. */
const focusedOn = (el: HTMLElement | null) => el !== null && document.activeElement === el;

describe("cofre-ui: a panel takes the focus when it opens and gives it back when it closes (#2604)", () => {
  test("Novo segredo moves the focus to Nome, and Cancelar returns it to Novo segredo", async () => {
    await open();
    await click("Novo segredo");
    expect(focusedOn(screen.queryByLabelText("Nome"))).toBe(true);
    await click("Cancelar");
    expect(focusedOn(button("Novo segredo"))).toBe(true);
  });

  test("Editar moves the focus to Nome and scrolls the panel into view, and Cancelar returns it to Editar", async () => {
    await open();
    await click("Editar deploy");
    expect(focusedOn(screen.queryByLabelText("Nome"))).toBe(true);
    expect(scrolled.some((el) => el.tagName === "FORM")).toBe(true);
    await click("Cancelar");
    expect(focusedOn(button("Editar deploy"))).toBe(true);
  });

  test("Salvar alterações also returns the focus to Editar", async () => {
    await open();
    await click("Editar deploy");
    await click("Salvar alterações");
    expect(focusedOn(button("Editar deploy"))).toBe(true);
  });

  test("Regras moves the focus to its first control, and Cancelar returns it to Regras", async () => {
    await open();
    await click("Regras de deploy");
    const region = screen.queryByRole("region", { name: "Regras de deploy" });
    expect(region === null).toBe(false);
    expect(region?.contains(document.activeElement)).toBe(true);
    expect(focusedOn(region?.querySelector("select") ?? null)).toBe(true);
    expect(scrolled.some((el) => el.tagName === "SECTION")).toBe(true);
    await click("Cancelar");
    expect(focusedOn(button("Regras de deploy"))).toBe(true);
  });
});
