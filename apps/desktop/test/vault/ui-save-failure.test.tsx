import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { legacyDaemon } from "../legacy-daemon.ts";
import { settle } from "../wait.ts";
import { addedSecret } from "./added-secret.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { VaultPage } = await import("../../src/features/vault/page.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const VALUE = "save-failure-value-0123456789";

/** The page over a store whose keyring can be told to refuse a write or a delete. */
async function open() {
  const { platform } = memoryPlatform();
  const keyring = { setFails: false, deleteFails: false };
  const set = platform.vault.set.bind(platform.vault);
  const del = platform.vault.delete.bind(platform.vault);
  platform.vault.set = async (id, value) => {
    if (keyring.setFails) throw new Error("the keyring is locked");
    return set(id, value);
  };
  platform.vault.delete = async (id) => {
    if (keyring.deleteFails) throw new Error("the keyring refused the delete");
    return del(id);
  };
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  const daemon = legacyDaemon(cleanups);
  await store.roster.add({ name: "h", url: daemon.url, token: TOKEN });
  render(<VaultPage store={store} />);
  return { store, keyring };
}

const errors = (store: Awaited<ReturnType<typeof open>>["store"]) =>
  store
    .getState()
    .notices.filter((n) => n.kind === "error")
    .map((n) => n.text);

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const fill = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
};

describe("cofre-ui: a save or a removal that fails (#2601)", () => {
  test("a refused save says why, keeps the form open and keeps what was typed", async () => {
    const { store, keyring } = await open();
    keyring.setFails = true;
    await click("Novo segredo");
    await fill("Nome", "github");
    await fill("Valor", VALUE);
    await click("Guardar");
    await settle(() => errors(store).length > 0);
    expect(errors(store)).toEqual(["the keyring is locked"]);
    expect(errors(store).join(" ")).not.toContain(VALUE);
    expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeNull();
    expect((screen.queryByLabelText("Nome") as HTMLInputElement).value).toBe("github");
    expect((screen.queryByLabelText("Valor") as HTMLTextAreaElement).value).toBe(VALUE);
    expect(store.getState().secrets).toEqual([]);
  });

  test("a save that works after a refused one closes the form and lists the secret", async () => {
    const { store, keyring } = await open();
    keyring.setFails = true;
    await click("Novo segredo");
    await fill("Nome", "github");
    await fill("Valor", VALUE);
    await click("Guardar");
    await settle(() => errors(store).length > 0);
    keyring.setFails = false;
    await click("Guardar");
    await settle(() => store.getState().secrets.length === 1);
    expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
  });

  test("a refused removal says why, and the secret is still listed and still readable", async () => {
    const { store, keyring } = await open();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    cleanups.push(() => process.off("unhandledRejection", onUnhandled));
    const meta = await addedSecret(store, { name: "github", type: "password", value: VALUE });
    keyring.deleteFails = true;
    await click("Remover github");
    await fill("Digite github para confirmar", "github");
    await click("Remover");
    await settle(() => errors(store).length > 0);
    expect(unhandled).toEqual([]);
    expect(errors(store)).toEqual(["the keyring refused the delete"]);
    expect(store.getState().secrets.map((s) => s.id)).toEqual([meta.id]);
    expect(store.vault.list().map((s) => s.name)).toEqual(["github"]);
    expect(await store.vault.value(meta.id)).toBe(VALUE);
  });

  test("after a removal the row is gone, so the focus goes to the New secret button, not to the top of the page (#2603)", async () => {
    const { store } = await open();
    await addedSecret(store, { name: "github", type: "password", value: VALUE });
    await click("Remover github");
    await fill("Digite github para confirmar", "github");
    await click("Remover");
    await settle(() => store.getState().secrets.length === 0);
    const button = screen.getByRole("button", { name: "Novo segredo" });
    await settle(() => document.activeElement === button);
    expect(document.activeElement).toBe(button);
  });
});
