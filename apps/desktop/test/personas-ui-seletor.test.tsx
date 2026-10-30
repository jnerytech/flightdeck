import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform } from "./fixtures.ts";
import { personasHost } from "./personas-ui-setup.ts";

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

async function open() {
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const h = await personasHost(cleanups, store);
  store.globalPersonas.save({
    id: "minha",
    name: "Minha persona",
    description: "Do app",
    body: "Seja breve.",
  });
  render(<App store={store} />);
  await settle(() => store.getState().hosts[0]?.hostInfo?.features?.includes("personas") === true);
  return { store, ...h };
}

async function click(name: string) {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
  await act(() => Bun.sleep(150));
}

async function fill(label: string, value: string) {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
  await act(() => Bun.sleep(40));
}

const options = (label: string) =>
  [...((screen.queryByLabelText(label) as HTMLSelectElement | null)?.options ?? [])].map(
    (o) => o.textContent ?? "",
  );

describe("personas-ui: choosing a persona when a session opens", () => {
  test("+ nova sessão offers the host's personas and the app's, and the session opens in the one chosen", async () => {
    const { store, hostId, d } = await open();
    await act(async () => {
      store.router.push({ name: "new-session", host: hostId });
    });
    await settle(() => options("Persona").length > 1);
    expect(options("Persona")).toEqual(
      expect.arrayContaining(["Nenhuma", "Revisor de segurança", "Minha persona"]),
    );
    await fill("Persona", "host:seguranca");
    await fill("Primeiro prompt", "revise isto");
    await click("Criar sessão");
    await poll(() => d.manager.list().length === 1);
    expect(d.manager.list()[0]?.persona).toMatchObject({
      id: "seguranca",
      name: "Revisor de segurança",
    });
  });

  test("an app persona goes as its whole definition", async () => {
    const { store, hostId, d } = await open();
    await act(async () => {
      store.router.push({ name: "new-session", host: hostId });
    });
    await settle(() => options("Persona").length > 1);
    await fill("Persona", "app:minha");
    await fill("Primeiro prompt", "oi");
    await click("Criar sessão");
    await poll(() => d.manager.list().length === 1);
    expect(d.manager.list()[0]?.persona).toMatchObject({ id: "minha", name: "Minha persona" });
  });

  test("the palette offers Nova sessão como <persona>, which opens the form with it chosen", async () => {
    const { store } = await open();
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    });
    const dialog = () => screen.queryByRole("dialog", { name: "Busca global" });
    const option = () =>
      dialog()
        ? within(dialog() as HTMLElement).queryByRole("option", {
            name: "Nova sessão como Revisor de segurança",
          })
        : null;
    await settle(() => option() !== null);
    expect(option()).not.toBeNull();
    await act(async () => {
      fireEvent.click(option() as HTMLElement);
    });
    await settle(() => store.router.current.name === "new-session");
    await settle(() => options("Persona").length > 1);
    expect((screen.queryByLabelText("Persona") as HTMLSelectElement | null)?.value).toBe(
      "host:seguranca",
    );
  });

  test("a card starts in the persona chosen next to Iniciar", async () => {
    const { store, hostId, projectId, d } = await open();
    const card = d.board.createCard(projectId, { title: "Revisar", description: "faça" });
    const asked: Array<{ type: string; payload: unknown }> = [];
    const command = store.hostCommand.bind(store);
    store.hostCommand = (async (id: string, type: never, payload: never) => {
      asked.push({ type, payload });
      return command(id, type, payload);
    }) as typeof store.hostCommand;
    await act(async () => {
      store.router.push({ name: "card", host: hostId, projectId, cardId: card.id });
    });
    await settle(() => options("Persona do card").length > 1);
    await fill("Persona do card", "host:qa");
    await click("Iniciar");
    expect(asked.find((a) => a.type === "card.start")?.payload).toMatchObject({
      cardId: card.id,
      persona: { id: "qa", language: "pt-BR" },
    });
  });

  test("Claude aqui runs flightdeckd claude --persona with the persona chosen; the app's own are not offered there", async () => {
    const { store, hostId, d, repo } = await open();
    await act(async () => {
      store.router.push({ name: "host", host: hostId });
    });
    await act(() => Bun.sleep(200));
    const { TerminalButton } = await import("../src/ui/TerminalButton.tsx");
    const { TContext } = await import("../src/i18n/context.tsx");
    cleanup();
    render(
      <TContext.Provider value={store.i18n.t}>
        <TerminalButton
          store={store}
          hostId={hostId}
          target={{ cwd: repo, claudeSessionId: null }}
        />
      </TContext.Provider>,
    );
    await settle(() => options("Persona do Claude aqui").length > 1);
    expect(options("Persona do Claude aqui")).not.toContain("Minha persona");
    await fill("Persona do Claude aqui", "qa");
    await click("Abrir Claude aqui (terminal)");
    await poll(() => d.ptys.spawned.length === 1);
    expect(d.ptys.spawned[0]?.argv.slice(-2)).toEqual(["--persona", "qa"]);
  });
});
