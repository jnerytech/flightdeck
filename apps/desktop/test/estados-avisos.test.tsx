import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const alerts = () => screen.queryAllByRole("alert");
const alertTexts = () => alerts().map((a) => a.textContent ?? "");

async function online(language = "pt-BR") {
  const d = makeDaemon(cleanups);
  const mem = memoryPlatform(false, language);
  const copied: string[] = [];
  mem.platform.copyText = async (text) => {
    copied.push(text);
  };
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  return { d, store, copied, hostId: store.getState().hosts[0]?.id ?? "" };
}

describe("estados-avisos", () => {
  test("erros viram toasts traduzidos pelo code, com Detalhes, e não se apagam uns aos outros", async () => {
    const { store, hostId } = await online();
    await act(async () => {
      await store.createSession(hostId, { cwd: "/fora/de/tudo", prompt: "oi" });
      await store.hostCommand(hostId, "card.get", { cardId: "nao-existe" });
    });
    await settle(() => alerts().length === 2);
    expect(alertTexts().join(" | ")).toContain("A pasta está fora das pastas permitidas do host.");
    expect(alertTexts().join(" | ")).toContain("Não encontrado no host.");
    const notFound = alerts().find((a) => (a.textContent ?? "").includes("Não encontrado"));
    // The daemon's own message is behind "Detalhes".
    expect(notFound?.textContent ?? "").not.toContain("nao-existe");
    const details = notFound ? within(notFound).queryByRole("button", { name: "Detalhes" }) : null;
    expect(details).not.toBeNull();
    await act(async () => {
      fireEvent.click(details as HTMLElement);
    });
    expect(notFound?.textContent ?? "").toContain("nao-existe");
    const close = notFound ? within(notFound).queryByRole("button", { name: "Fechar" }) : null;
    expect(close).not.toBeNull();
    await act(async () => {
      fireEvent.click(close as HTMLElement);
      await Bun.sleep(400);
    });
    await settle(() => alerts().length === 1);
    expect(alertTexts()).toEqual([expect.stringContaining("A pasta está fora")]);
  });

  test("código desconhecido mostra a mensagem do daemon; em inglês, os títulos também", async () => {
    const { store, hostId } = await online("en-US");
    await act(async () => {
      store.reportError("Link de pareamento recusado: porta inválida");
      await store.hostCommand(hostId, "card.get", { cardId: "x" });
    });
    await settle(() => alerts().length === 2);
    expect(alertTexts().join(" | ")).toContain("Link de pareamento recusado: porta inválida");
    expect(alertTexts().join(" | ")).toContain("Not found on the host.");
  });

  test("sucesso em toast curto: copiar o comando e iniciar um card", async () => {
    const { store, copied } = await online();
    await act(async () => {
      expect(await store.copyText("flightdeckd claude --resume x")).toBe(true);
    });
    expect(copied).toEqual(["flightdeckd claude --resume x"]);
    await settle(() => (document.body.textContent ?? "").includes("Copiado"));
    expect(document.body.textContent ?? "").toContain("Copiado");
    expect(alerts()).toEqual([]);
  });
});
