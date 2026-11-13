import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "../dom.ts";
import { memoryPlatform, TOKEN } from "../fixtures.ts";
import { legacyDaemon } from "../legacy-daemon.ts";
import { uiIdle } from "../wait.ts";

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

/** The page over an empty vault, with the New secret form open. */
async function openForm() {
  const { platform } = memoryPlatform();
  const store = new AppStore(platform, { baseDelayMs: 60_000 });
  const daemon = legacyDaemon(cleanups);
  await store.roster.add({ name: "box", url: daemon.url, token: TOKEN });
  render(<VaultPage store={store} />);
  const open = screen.queryAllByRole("button", { name: "Novo segredo" })[0] as HTMLElement;
  await act(async () => {
    fireEvent.click(open);
  });
  await uiIdle();
}

const fill = async (label: string, value: string) => {
  await act(async () => {
    fireEvent.change(screen.queryByLabelText(label) as HTMLElement, { target: { value } });
  });
};
const disabled = (name: string) =>
  (screen.queryByRole("button", { name }) as HTMLButtonElement).disabled;
const said = (text: string) => screen.queryByText(text) !== null;

const NEED_NAME = "Dê um nome ao segredo";
const NEED_VALUE = "Dê um valor ao segredo";

describe("cofre-ui: the New secret form says why a button is off (#2606)", () => {
  test("an empty form says a name is needed, and Guardar, Gerar and Importar are off", async () => {
    await openForm();
    expect(disabled("Guardar")).toBe(true);
    expect(disabled("Gerar chave SSH")).toBe(true);
    expect(disabled("Importar arquivo de chave")).toBe(true);
    expect(said(NEED_NAME)).toBe(true);
  });

  test("with a name and no value, it says a value is needed", async () => {
    await openForm();
    await fill("Nome", "deploy");
    expect(disabled("Guardar")).toBe(true);
    expect(disabled("Gerar chave SSH")).toBe(false);
    expect(said(NEED_NAME)).toBe(false);
    expect(said(NEED_VALUE)).toBe(true);
  });

  test("with a name and a value, no reason shows and Guardar is on", async () => {
    await openForm();
    await fill("Nome", "deploy");
    await fill("Valor", "reasons-value-0123456789");
    expect(disabled("Guardar")).toBe(false);
    expect(said(NEED_NAME) || said(NEED_VALUE)).toBe(false);
  });

  test("the delete-original box says it applies to Importar arquivo de chave", async () => {
    await openForm();
    const hint = "Vale só para “Importar arquivo de chave”.";
    expect(said(hint)).toBe(true);
    const box = screen.queryByLabelText("Apagar o arquivo original depois de importar");
    const hintId = screen.queryByText(hint)?.id ?? "";
    expect(hintId !== "" && box?.getAttribute("aria-describedby") === hintId).toBe(true);
  });
});
