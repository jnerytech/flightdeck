import { afterEach, describe, expect, test } from "bun:test";
import { formatPairingLink, parsePairingLink } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const {
  act,
  cleanup,
  fireEvent,
  render,
  within,
  waitFor: rtlWaitFor,
} = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });
const value = (label: string) => {
  const element = screen.queryByLabelText(label) as HTMLInputElement | null;
  expect(element).not.toBeNull();
  return element?.value;
};

function setup() {
  const d = makeDaemon(cleanups);
  const server = d.listen();
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, { baseDelayMs: 10 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  return { ...d, server, store, ...mem };
}

describe("deep-link", () => {
  test("esquema errado, token ausente, porta inválida e endereço vazio são recusados", () => {
    expect(parsePairingLink("http://pc:7420?token=a")).toEqual({
      ok: false,
      error: "esquema inválido",
    });
    expect(parsePairingLink("flightdeck://pc:7420?name=x")).toEqual({
      ok: false,
      error: "token ausente",
    });
    expect(parsePairingLink("flightdeck://pc:7420?token=")).toEqual({
      ok: false,
      error: "token ausente",
    });
    for (const port of ["0", "70000", "abc", ""]) {
      expect(parsePairingLink(`flightdeck://pc:${port}?token=a`)).toEqual({
        ok: false,
        error: "porta inválida",
      });
    }
    expect(parsePairingLink("flightdeck://pc?token=a")).toEqual({
      ok: false,
      error: "porta inválida",
    });
    expect(parsePairingLink("flightdeck://:7420?token=a")).toEqual({
      ok: false,
      error: "endereço inválido",
    });
    expect(parsePairingLink("FLIGHTDECK://pc:7420?token=a")).toMatchObject({ ok: true });
  });

  test("link válido vira formulário preenchido e só salva depois da confirmação", async () => {
    const { deepLink, server, store } = setup();
    const port = Number(new URL(server.url.replace("ws://", "http://")).port);
    await act(async () => {
      deepLink(formatPairingLink({ address: "127.0.0.1", port, name: "via link", token: TOKEN }));
    });
    await waitFor(() => expect(value("Nome")).toBe("via link"));
    expect(value("Endereço")).toBe("127.0.0.1");
    expect(value("Porta")).toBe(String(port));
    expect(value("Token")).toBe(TOKEN);
    expect(screen.queryByText(/veio de fora do app/)).not.toBeNull();
    expect(store.getState().hosts).toEqual([]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Testar e adicionar" }));
    });
    await waitFor(() => expect(screen.queryByLabelText("via link: online")).not.toBeNull());
  });

  test("link inválido não abre o formulário e mostra o motivo", async () => {
    const { deepLink, store } = setup();
    await act(async () => {
      deepLink("flightdeck://pc:99999?token=a");
    });
    await waitFor(() =>
      expect(screen.queryByRole("alert")?.textContent ?? "").toContain(
        "Link de pareamento recusado: porta inválida",
      ),
    );
    expect(value("Nome")).toBe("");
    expect(store.getState().hosts).toEqual([]);
  });

  test("colar link inválido no campo não altera os outros campos", () => {
    setup();
    const link = screen.getByLabelText("Link de pareamento");
    fireEvent.change(link, { target: { value: "flightdeck://pc:1" } });
    expect(value("Endereço")).toBe("");
    expect(screen.queryByText("token ausente")).not.toBeNull();
  });
});
