import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, waitFor as poll, TOKEN } from "./fixtures.ts";

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

/** The confirmation's button with `name` (the dialog is an alertdialog), clicked. */
async function confirmWith(name: string) {
  const dialog = screen.queryByRole("alertdialog");
  expect(dialog).not.toBeNull();
  const button = within(dialog as HTMLElement).queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
}
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");
const { formatBytes } = await import("../src/ui/MaintenanceSection.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const waitFor = <T,>(fn: () => T) => rtlWaitFor(fn, { timeout: 3000 });
const text = () => document.body.textContent ?? "";
const RETENTION = { eventsDays: 0, externalSessionsDays: 0 };

async function setup(options: Parameters<typeof makeDaemon>[1] = { retention: RETENTION }) {
  const d = makeDaemon(cleanups, options);
  const server = d.listen(0);
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 10 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "pc", url: server.url, token: TOKEN }));
  await waitFor(() => expect(screen.queryByLabelText("pc: online")).not.toBeNull());
  return { ...d, store, hostId };
}

async function openHost() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Abrir host pc" }));
  });
}

/** Opens the host page and waits for its Manutenção section. */
async function openMaintenance() {
  await openHost();
  await waitFor(() => expect(screen.queryByLabelText("Manutenção")).not.toBeNull());
}

const section = () => screen.getByLabelText("Manutenção");
/** What the section says next to a label: the description that follows its term. */
const fact = (label: string) =>
  [...section().querySelectorAll("dt")].find((dt) => dt.textContent === label)?.nextElementSibling
    ?.textContent;
const click = async (name: string) => {
  await act(async () => {
    fireEvent.click(within(section()).getByRole("button", { name }));
  });
};

/** An ended session with a few events, past the retention of 0 days. */
async function endedSession(d: Awaited<ReturnType<typeof setup>>) {
  const { sessionId } = d.manager.create({ cwd: d.project, prompt: "oi", name: "Antiga" });
  await poll(() => d.manager.get(sessionId).status === "idle", "sessão ociosa");
  await d.manager.close(sessionId);
  await poll(() => d.manager.get(sessionId).status === "ended", "sessão encerrada");
  return sessionId;
}

const eventCount = (d: Awaited<ReturnType<typeof setup>>, sessionId: string) =>
  (
    d.eventStore.db
      .query("SELECT COUNT(*) AS n FROM events WHERE session_id = ?")
      .get(sessionId) as {
      n: number;
    }
  ).n;

describe("manutencao-ui", () => {
  test("tamanhos em B, KB ou MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  test("seção Manutenção mostra o banco, o último backup e a última limpeza", async () => {
    await setup();
    await openMaintenance();
    await waitFor(() => expect(fact("Banco")).toMatch(/^\d/));
    expect(fact("Último backup")).toBe("nenhum ainda");
    expect(fact("Última limpeza")).toBe("nenhuma ainda");
    for (const label of ["Sessões", "Eventos", "Sessões externas"]) {
      expect(fact(label)).toMatch(/^\d+$/);
    }
  });

  test("Fazer backup agora cria o arquivo e atualiza o último backup", async () => {
    const d = await setup();
    await openMaintenance();
    await waitFor(() => expect(fact("Último backup")).toBe("nenhum ainda"));
    await click("Fazer backup agora");
    await waitFor(() => expect(fact("Último backup")).not.toBe("nenhum ainda"));
    expect(fact("Último backup")).toMatch(/.+ \(\d+(\.\d)? (B|KB|MB)\)$/);
    const backups = join(d.root, "data", "backups");
    expect(existsSync(backups) ? readdirSync(backups) : []).toHaveLength(1);
  });

  test("Simular conta sem apagar; Limpar pede confirmação e apaga", async () => {
    const d = await setup();
    const sessionId = await endedSession(d);
    const before = eventCount(d, sessionId);
    expect(before).toBeGreaterThan(0);
    await openMaintenance();
    await waitFor(() => expect(fact("Última limpeza")).toBe("nenhuma ainda"));
    await click("Simular");
    await waitFor(() =>
      expect(section().textContent).toContain(`seriam apagados: eventos ${before}`),
    );
    expect(eventCount(d, sessionId)).toBe(before);
    expect(section().textContent).toContain("(simulação)");
    // Cancelling the confirmation keeps everything.
    await click("Limpar");
    expect(text()).toContain("Apagar os dados antigos deste host");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    });
    expect(eventCount(d, sessionId)).toBe(before);
    await click("Limpar");
    await confirmWith("Limpar");
    // "seriam apagados: …" also contains "apagados: …": wait for the simulation message to go.
    await waitFor(() => expect(section().textContent).not.toContain("seriam apagados"));
    expect(section().textContent).toContain(`apagados: eventos ${before}`);
    expect(eventCount(d, sessionId)).toBe(0);
    expect(section().textContent).not.toContain("(simulação)");
  });

  test("host que não anuncia maintenance não tem a seção", async () => {
    await setup({});
    await openHost();
    await waitFor(() => expect(text()).toContain("sessões ativas: 0"));
    expect(screen.queryByLabelText("Manutenção")).toBeNull();
  });

  test("conversa limpa pela retenção avisa em vez de aparecer vazia", async () => {
    const d = await setup();
    const sessionId = await endedSession(d);
    d.maintenance?.prune(false);
    expect(eventCount(d, sessionId)).toBe(0);
    await act(async () => {
      d.store.select(d.hostId, sessionId);
    });
    await waitFor(() => expect(text()).toContain("conversa removida pela retenção"));
    // A session with its events keeps showing them.
    const kept = d.manager.create({ cwd: d.project, prompt: "fica", name: "Nova" });
    await poll(() => d.manager.get(kept.sessionId).status === "idle", "sessão ociosa");
    await act(async () => {
      d.store.select(d.hostId, kept.sessionId);
    });
    await waitFor(() => expect(text()).toContain("fica"));
    expect(text()).not.toContain("conversa removida pela retenção");
  });
});
