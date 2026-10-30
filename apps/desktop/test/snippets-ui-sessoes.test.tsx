import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ExternalSession } from "@flightdeck/protocol";
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

const external = (cwd: string): ExternalSession => ({
  claudeSessionId: "ext-1",
  cwd,
  transcriptPath: null,
  source: null,
  status: "idle",
  statusReason: null,
  launchId: null,
  controllable: true,
  projectKey: null,
  startedAt: "2026-10-30T12:00:00Z",
  lastEventAt: "2026-10-30T12:00:00Z",
  endedAt: null,
});

/** The app with prompt snippets; `onExternal` puts a controllable terminal session on screen. */
async function open(onExternal = false) {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await snippetsHost(cleanups, store);
  await h.save({ name: "revisar", type: "prompt", text: "Revise o projeto em {{cwd}}." });
  store.globalSnippets.save({ name: "resumir", type: "prompt", text: "Resuma o que mudou." });
  // What the app asks of the host, to see what a send carries (the daemon has no such session).
  const asked: Array<{ type: string; payload: unknown }> = [];
  const request = store.hostRequest.bind(store);
  store.hostRequest = (async (hostId: string, type: never, payload: never) => {
    asked.push({ type, payload });
    return request(hostId, type, payload);
  }) as typeof store.hostRequest;
  const command = store.hostCommand.bind(store);
  store.hostCommand = (async (hostId: string, type: never, payload: never) => {
    asked.push({ type, payload });
    return command(hostId, type, payload);
  }) as typeof store.hostCommand;
  render(<App store={store} />);
  await settle(() => store.getState().hosts[0]?.hostInfo?.features?.includes("snippets") === true);
  if (onExternal) {
    await act(async () => {
      (store as unknown as { update(patch: object): void }).update({
        externals: { [`${h.hostId}/ext-1`]: external(h.d.project) },
      });
      store.router.push({ name: "external", host: h.hostId, claudeSessionId: "ext-1" });
    });
    await act(() => Bun.sleep(100));
  }
  return { store, asked, ...h };
}

async function palette(label: string) {
  await act(async () => {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  });
  const dialog = () => screen.queryByRole("dialog", { name: "Busca global" });
  await settle(
    () =>
      dialog() !== null &&
      within(dialog() as HTMLElement).queryByRole("option", { name: label }) !== null,
  );
  const option = dialog()
    ? within(dialog() as HTMLElement).queryByRole("option", { name: label })
    : null;
  expect(option).not.toBeNull();
  await act(async () => {
    fireEvent.click(option as HTMLElement);
  });
  await act(() => Bun.sleep(100));
}

async function click(name: string) {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await act(() => Bun.sleep(150));
}

describe("snippets-uso: terminal sessions and new sessions", () => {
  test("/ in a terminal session's message box lists the prompt snippets and fills the chosen one from its folder", async () => {
    const { d } = await open(true);
    const box = () =>
      screen.queryByLabelText("Mensagem para a sessão") as HTMLTextAreaElement | null;
    expect(box()).not.toBeNull();
    await act(async () => {
      fireEvent.change(box() as HTMLElement, { target: { value: "/rev" } });
    });
    await act(() => Bun.sleep(150));
    const option = screen.queryByRole("option", { name: "revisar" });
    expect(option).not.toBeNull();
    await act(async () => {
      fireEvent.click(option as HTMLElement);
    });
    await settle(() => box()?.value.startsWith("Revise") === true);
    expect(box()?.value).toBe(`Revise o projeto em ${d.project}.`);
  });

  test("from the palette, a prompt goes to the terminal session on screen", async () => {
    const { asked } = await open(true);
    await palette("Snippet: resumir");
    await click("Enviar à sessão");
    expect(asked).toContainEqual({
      type: "external.message",
      payload: { claudeSessionId: "ext-1", text: "Resuma o que mudou." },
    });
  });

  test("a host's prompt goes to the terminal session through the daemon's own use", async () => {
    const { asked } = await open(true);
    await palette("Snippet: revisar");
    await click("Enviar à sessão");
    expect(asked.find((a) => a.type === "snippets.use")?.payload).toMatchObject({
      action: "send",
      claudeSessionId: "ext-1",
    });
  });

  test("Nova sessão com este prompt opens the new-session form with the prompt filled in", async () => {
    const { store, hostId } = await open();
    await palette("Snippet: resumir");
    await click("Nova sessão com este prompt");
    expect(store.router.current).toMatchObject({ name: "new-session", host: hostId });
    await settle(() => screen.queryByLabelText("Primeiro prompt") !== null);
    expect((screen.queryByLabelText("Primeiro prompt") as HTMLTextAreaElement | null)?.value).toBe(
      "Resuma o que mudou.",
    );
  });
});
