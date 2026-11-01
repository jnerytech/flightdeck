import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { VaultPage } = await import("../src/ui/VaultPage.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const VALUE = "reveal-test-value-0123456789";
const REVEAL_MS = 150;
const CLEAR_MS = 150;

const settle = waiter(4000);

/** The page on its own, over a store whose clipboard is a list. */
async function open() {
  const { platform } = memoryPlatform();
  const copied: string[] = [];
  platform.copyText = async (text) => {
    copied.push(text);
  };
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  const daemon = legacyDaemon(cleanups);
  await store.addHost({ name: "h", url: daemon.url, token: TOKEN });
  await store.addSecret({ name: "github", type: "password", value: VALUE });
  render(<VaultPage store={store} revealMs={REVEAL_MS} clearMs={CLEAR_MS} />);
  return { store, copied };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const type = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
};

describe("cofre-ui: reveal and copy", () => {
  test("Revelar asks for the word before showing anything, and a wrong word keeps the value hidden", async () => {
    await open();
    await click("Revelar github");
    expect(document.body.textContent).not.toContain(VALUE);
    await type("Digite revelar para confirmar", "mostrar");
    const confirm = screen.queryByRole("button", { name: "Revelar" }) as HTMLButtonElement | null;
    expect(confirm?.disabled).toBe(true);
    expect(document.body.textContent).not.toContain(VALUE);
  });

  test("the right word shows the value, and it hides again after the deadline", async () => {
    await open();
    await click("Revelar github");
    await type("Digite revelar para confirmar", "revelar");
    await click("Revelar");
    expect(await screen.findByText(VALUE)).not.toBeNull();
    await settle(() => !document.body.textContent?.includes(VALUE), 3000);
    expect(document.body.textContent).not.toContain(VALUE);
  });

  test("cancelling the confirmation shows nothing", async () => {
    await open();
    await click("Revelar github");
    await click("Cancelar");
    expect(document.body.textContent).not.toContain(VALUE);
  });

  test("Copiar puts the value on the clipboard and clears the clipboard after the deadline", async () => {
    const { copied } = await open();
    await click("Copiar github");
    await settle(() => copied.includes(VALUE));
    expect(copied).toEqual([VALUE]);
    await settle(() => copied.length === 2, 3000);
    expect(copied).toEqual([VALUE, ""]);
  });
});
