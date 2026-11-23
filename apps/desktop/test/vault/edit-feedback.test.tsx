import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { legacyDaemon } from "../legacy-daemon.ts";
import { uiIdle, waiter } from "../wait.ts";
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

const settle = waiter(4000);

/** The page over a store with one secret named "deploy"; with a host named "box" unless told not to. */
async function open(options: { host: boolean } = { host: true }) {
  const { platform } = memoryPlatform();
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  const daemon = legacyDaemon(cleanups);
  const hostId = options.host
    ? await store.roster.add({ name: "box", url: daemon.url, token: TOKEN })
    : "";
  const meta = await addedSecret(store, {
    name: "deploy",
    type: "password",
    value: "feedback-0123",
  });
  render(<VaultPage store={store} />);
  if (options.host) await settle(() => store.getState().hosts.length > 0);
  return { store, hostId, meta };
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await uiIdle();
};

const fill = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
};

const said = (text: string) => screen.queryByText(text) !== null;

describe("cofre-ui: the Edit form says what happened (#4418)", () => {
  test("an empty name turns Salvar alterações off and says why", async () => {
    await open();
    await click("Editar deploy");
    expect(said("Dê um nome ao segredo")).toBe(false);
    await fill("Nome", "  ");
    const save = screen.queryByRole("button", { name: "Salvar alterações" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(said("Dê um nome ao segredo")).toBe(true);
  });

  test("a saved change is said by name once the form is closed", async () => {
    await open();
    await click("Editar deploy");
    await fill("Nome", "deploy prod");
    await click("Salvar alterações");
    expect(screen.queryByLabelText("Nome")).toBeNull();
    const status = screen.queryByText("deploy prod salvo");
    expect(status).not.toBeNull();
    expect((status as HTMLElement).closest("[aria-live=polite]")).not.toBeNull();
  });

  test("a cancelled edit says nothing was saved", async () => {
    await open();
    await click("Editar deploy");
    await fill("Nome", "deploy prod");
    await click("Cancelar");
    expect(screen.queryByText(/salvo$/)).toBeNull();
  });

  test("with no host in the list there is no Hosts permitidos block", async () => {
    await open({ host: false });
    await click("Editar deploy");
    expect(screen.queryByLabelText("Nome")).not.toBeNull();
    expect(screen.queryByText("Hosts permitidos")).toBeNull();
  });
});

describe("cofre-ui: a secret no host may use says so (#4419)", () => {
  test("its row says that no host may use it, not an empty list", async () => {
    const { store, meta } = await open();
    await act(async () => {
      store.secrets.update(meta.id, { allowedHosts: [] });
    });
    await uiIdle();
    expect(said("Nenhum host pode usar este segredo")).toBe(true);
    expect(screen.queryByText(/^Hosts permitidos: ?$/)).toBeNull();
  });

  test("a row with a host still lists it", async () => {
    await open();
    expect(said("Hosts permitidos: local")).toBe(true);
    expect(said("Nenhum host pode usar este segredo")).toBe(false);
  });

  test("unticking the last host warns before Salvar, and ticking one takes the warning away", async () => {
    const { store, meta, hostId } = await open();
    await act(async () => {
      store.secrets.update(meta.id, { allowedHosts: [hostId] });
    });
    await uiIdle();
    await click("Editar deploy");
    const warning = "Nenhum host poderá usar este segredo. Marque um host para permiti-lo.";
    expect(said(warning)).toBe(false);
    const box = screen.queryByLabelText("box") as HTMLElement;
    await act(async () => {
      fireEvent.click(box);
    });
    expect(said(warning)).toBe(true);
    const save = screen.queryByRole("button", { name: "Salvar alterações" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(box);
    });
    expect(said(warning)).toBe(false);
  });

  test("saving with no host stores an empty list: the warning does not block", async () => {
    const { store, meta, hostId } = await open();
    await act(async () => {
      store.secrets.update(meta.id, { allowedHosts: [hostId] });
    });
    await uiIdle();
    await click("Editar deploy");
    await act(async () => {
      fireEvent.click(screen.queryByLabelText("box") as HTMLElement);
    });
    await click("Salvar alterações");
    expect(store.vault.list()[0]).toMatchObject({ id: meta.id, allowedHosts: [] });
  });
});
