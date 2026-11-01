import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

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

async function open() {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  const daemon = legacyDaemon(cleanups);
  await store.addHost({ name: "h", url: daemon.url, token: TOKEN });
  const meta = await store.addSecret({
    name: "github",
    type: "password",
    value: "remove-test-value",
  });
  const view = render(<VaultPage store={store} />);
  return { store, meta, view };
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

const LABEL = "Digite github para confirmar";

describe("cofre-ui: remove", () => {
  test("Remover asks for the secret's name, and another word keeps the button closed", async () => {
    const { store, meta } = await open();
    await click("Remover github");
    await type(LABEL, "gitlab");
    const confirm = screen.queryByRole("button", { name: "Remover" }) as HTMLButtonElement | null;
    expect(confirm?.disabled).toBe(true);
    expect(store.getState().secrets.map((s) => s.id)).toEqual([meta.id]);
  });

  test("the exact name removes the secret from the list and the keyring", async () => {
    const { store, meta } = await open();
    await click("Remover github");
    await type(LABEL, "github");
    await click("Remover");
    await act(() => Bun.sleep(20));
    expect(store.getState().secrets).toEqual([]);
    expect(await store.vault.value(meta.id)).toBeNull();
  });

  test("cancelling keeps the secret", async () => {
    const { store } = await open();
    await click("Remover github");
    await click("Cancelar");
    expect(store.getState().secrets).toHaveLength(1);
  });
});
