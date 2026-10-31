import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
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

/** A host with two snippets, a global one, and the app on that host's open terminal. */
async function open(withTerminal = true, extra: Array<Record<string, unknown>> = []) {
  const platform = memoryPlatform(false, "pt-BR");
  const copied: string[] = [];
  platform.platform.copyText = async (text) => {
    copied.push(text);
  };
  const store = new AppStore(platform.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await snippetsHost(cleanups, store);
  await h.save({
    name: "testes",
    type: "command",
    run: "bun test {{arquivo}}",
    vars: { arquivo: { default: "a.ts" } },
  });
  await h.save({ name: "deploy", type: "command", run: "kubectl apply -f k8s", tags: ["k8s"] });
  for (const input of extra) await h.save(input);
  store.globalSnippets.save({
    name: "eco",
    type: "command",
    run: "echo {{msg}}",
    vars: { msg: { default: "oi" } },
  });
  render(<App store={store} />);
  // The palette reads the snippets of hosts whose features it already knows.
  await settle(() => store.getState().hosts[0]?.hostInfo?.features?.includes("snippets") === true);
  let terminalId = "";
  if (withTerminal) {
    terminalId = (await store.terminalHost(h.hostId).open(h.d.project, 80, 24)).terminalId;
    await act(async () => {
      store.router.push({ name: "terminal", host: h.hostId, terminalId });
    });
    await act(() => Bun.sleep(100));
  }
  return { store, copied, terminalId, ...h };
}

const dialog = () => screen.queryByRole("dialog", { name: "Busca global" });
const options = () =>
  (dialog() ? within(dialog() as HTMLElement).queryAllByRole("option") : []).map(
    (o) => o.getAttribute("aria-label") ?? "",
  );

async function palette(query: string) {
  await act(async () => {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  });
  await settle(() => options().some((o) => o.startsWith("Snippet: ")));
  const field = screen.queryByLabelText("Buscar no histórico") as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value: query } });
  });
}

async function choose(label: string) {
  const option = within(dialog() as HTMLElement).queryByRole("option", { name: label });
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

describe("snippets-uso: the palette", () => {
  test("Ctrl+K offers Snippet: <name> for the host's and the app's snippets, matching the tags and the content too", async () => {
    await open();
    await palette("");
    expect(options()).toEqual(
      expect.arrayContaining(["Snippet: testes", "Snippet: deploy", "Snippet: eco"]),
    );
    await palette("k8s");
    expect(options().filter((o) => o.startsWith("Snippet: "))).toEqual(["Snippet: deploy"]);
    await palette("kubectl");
    expect(options().filter((o) => o.startsWith("Snippet: "))).toEqual(["Snippet: deploy"]);
  });

  test("a host command fills its fields and pastes into the open terminal, without Enter", async () => {
    const { d } = await open();
    await palette("testes");
    await choose("Snippet: testes");
    const field = screen.queryByLabelText("arquivo") as HTMLInputElement | null;
    expect(field?.value).toBe("a.ts");
    await act(async () => {
      fireEvent.change(field as HTMLElement, { target: { value: "b.ts" } });
    });
    await click("Colar no terminal");
    await settle(() => (d.ptys.spawned[0]?.written ?? []).join("").includes("bun test b.ts"));
    expect(d.ptys.spawned[0]?.written.join("")).toBe("bun test b.ts");
  });

  test("Colar e rodar adds the Enter", async () => {
    const { d } = await open();
    await palette("testes");
    await choose("Snippet: testes");
    await click("Colar e rodar");
    await settle(() => (d.ptys.spawned[0]?.written ?? []).join("").includes("\r"));
    expect(d.ptys.spawned[0]?.written.join("")).toBe("bun test a.ts\r");
  });

  test("a global command is filled in the app and pasted into the open terminal", async () => {
    const { d, store } = await open();
    await palette("eco");
    await choose("Snippet: eco");
    await click("Colar e rodar");
    await settle(() => (d.ptys.spawned[0]?.written ?? []).join("").includes("echo oi"));
    expect(d.ptys.spawned[0]?.written.join("")).toBe("echo oi\r");
    expect(store.globalSnippets.list()[0]?.uses).toBe(1);
  });

  test("Rodar numa aba nova opens a terminal in the folder given and runs the command there", async () => {
    const { d, store, hostId } = await open(false);
    await palette("deploy");
    await choose("Snippet: deploy");
    expect(screen.queryByRole("button", { name: "Colar no terminal" })).toBeNull();
    const folder = screen.queryByLabelText("Pasta") as HTMLInputElement | null;
    expect(folder).not.toBeNull();
    await act(async () => {
      fireEvent.change(folder as HTMLElement, { target: { value: d.project } });
    });
    await click("Rodar numa aba nova");
    await settle(() => store.router.current.name === "terminal");
    expect(store.router.current).toMatchObject({ name: "terminal", host: hostId });
    await settle(() => (d.ptys.spawned[0]?.written ?? []).join("").includes("kubectl"));
    expect(d.ptys.spawned[0]?.cwd).toBe(d.project);
    expect(d.ptys.spawned[0]?.written.join("")).toContain("kubectl apply -f k8s\r");
  });

  test("Copiar puts the filled text on the clipboard", async () => {
    const { copied } = await open(false);
    await palette("testes");
    await choose("Snippet: testes");
    await click("Copiar");
    expect(copied).toEqual(["bun test a.ts"]);
  });

  test("a host prompt with a field of options opens a new session filled with the option chosen", async () => {
    const { store, hostId } = await open(false, [
      {
        name: "revisar",
        type: "prompt",
        text: "Revise {{alvo}}",
        vars: { alvo: { default: "api", options: ["api", "web"] } },
      },
    ]);
    await palette("revisar");
    await choose("Snippet: revisar");
    const field = screen.queryByLabelText("alvo") as HTMLSelectElement | null;
    expect([...(field?.options ?? [])].map((o) => o.value)).toEqual(["api", "web"]);
    await act(async () => {
      fireEvent.change(field as HTMLSelectElement, { target: { value: "web" } });
    });
    await click("Nova sessão com este prompt");
    expect(store.router.current).toMatchObject({
      name: "new-session",
      host: hostId,
      prompt: "Revise web",
    });
  });

  test("a host prompt removed while its dialog is open opens the new session with the prompt as written", async () => {
    const { store, hostId } = await open(false, [
      { name: "explicar", type: "prompt", text: "Explique {{tema}}" },
    ]);
    await palette("explicar");
    await choose("Snippet: explicar");
    const listed = await store.hostCommand(hostId, "snippets.list", {});
    const id = listed?.snippets.find((x) => x.name === "explicar")?.id ?? "";
    await store.hostCommand(hostId, "snippets.remove", { id });
    await click("Nova sessão com este prompt");
    expect(store.router.current).toMatchObject({
      name: "new-session",
      host: hostId,
      prompt: "Explique {{tema}}",
    });
  });

  test("a global command removed while its dialog is open is not copied", async () => {
    const { store, copied } = await open(false);
    await palette("eco");
    await choose("Snippet: eco");
    const eco = store.globalSnippets.list().find((x) => x.name === "eco");
    store.globalSnippets.remove(eco?.id ?? "");
    await click("Copiar");
    expect(copied).toEqual([]);
  });
});
