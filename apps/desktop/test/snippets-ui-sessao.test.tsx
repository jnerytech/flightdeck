import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { snippetsHost } from "./snippets-ui-setup.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(15));
}

/** A managed session on screen, with prompt snippets of the host and of the app, and a command. */
async function open() {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await snippetsHost(cleanups, store);
  await h.save({ name: "revisar", type: "prompt", text: "Revise o projeto em {{cwd}}." });
  await h.save({ name: "explicar", type: "prompt", text: "Explique {{assunto}}." });
  await h.save({ name: "status", type: "command", run: "git status" });
  store.globalSnippets.save({ name: "resumir", type: "prompt", text: "Resuma o que mudou." });
  const { sessionId } = h.d.manager.create({ cwd: h.d.project, prompt: "oi", name: "Gerenciada" });
  await poll(() => h.d.manager.get(sessionId).status === "idle");
  render(<App store={store} />);
  await settle(() => store.getState().hosts[0]?.hostInfo?.features?.includes("snippets") === true);
  await act(async () => {
    store.router.push({ name: "session", host: h.hostId, id: sessionId });
  });
  await settle(() => screen.queryByLabelText("Mensagem") !== null);
  return { store, sessionId, ...h };
}

const box = () => screen.queryByLabelText("Mensagem") as HTMLTextAreaElement | null;
const typeInBox = async (text: string) => {
  expect(box()).not.toBeNull();
  await act(async () => {
    fireEvent.change(box() as HTMLElement, { target: { value: text } });
  });
  await act(() => Bun.sleep(150));
};
const menu = () => {
  const list = screen.queryByRole("listbox", { name: "Snippets de prompt" });
  return list
    ? within(list)
        .queryAllByRole("option")
        .map((o) => o.textContent ?? "")
    : [];
};

describe("snippets-uso: in the session", () => {
  test("/ in the message box lists the prompt snippets of the host and of the app, and not the commands", async () => {
    await open();
    await typeInBox("/");
    expect(menu().sort()).toEqual(["explicar", "resumir", "revisar"]);
    await typeInBox("/rev");
    expect(menu()).toEqual(["revisar"]);
  });

  test("choosing one puts its text in the box, filled from the session's folder", async () => {
    const { d } = await open();
    await typeInBox("/rev");
    const option = screen.queryByRole("option", { name: "revisar" });
    expect(option).not.toBeNull();
    await act(async () => {
      fireEvent.click(option as HTMLElement);
    });
    await settle(() => box()?.value.startsWith("Revise") === true);
    expect(box()?.value).toBe(`Revise o projeto em ${d.project}.`);
    expect(menu()).toEqual([]);
  });

  test("a snippet with a field to fill goes in as written, for the person to complete", async () => {
    await open();
    await typeInBox("/expl");
    const option = screen.queryByRole("option", { name: "explicar" });
    expect(option).not.toBeNull();
    await act(async () => {
      fireEvent.click(option as HTMLElement);
    });
    await settle(() => box()?.value.startsWith("Explique") === true);
    expect(box()?.value).toBe("Explique {{assunto}}.");
  });

  test("from the palette, a prompt snippet is sent to the session on screen", async () => {
    await open();
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    const dialog = () => screen.queryByRole("dialog", { name: "Busca global" });
    await settle(
      () =>
        dialog() !== null &&
        within(dialog() as HTMLElement).queryByRole("option", { name: "Snippet: resumir" }) !==
          null,
    );
    await act(async () => {
      fireEvent.click(
        within(dialog() as HTMLElement).queryByRole("option", {
          name: "Snippet: resumir",
        }) as HTMLElement,
      );
    });
    await act(() => Bun.sleep(100));
    const send = screen.queryByRole("button", { name: "Enviar à sessão" });
    expect(send).not.toBeNull();
    await act(async () => {
      fireEvent.click(send as HTMLElement);
    });
    await settle(() => document.body.textContent?.includes("Resuma o que mudou.") === true);
    expect(document.body.textContent).toContain("Resuma o que mudou.");
  });
});
