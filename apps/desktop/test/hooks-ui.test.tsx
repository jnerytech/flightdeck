import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Central } from "../../daemon/src/central/central.ts";
import { RECEPTOR_FILE } from "../../daemon/src/central/wrapper.ts";
import { loadConfig } from "../../daemon/src/config.ts";
import { poll } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const click = async (name: string) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const hooksState = () => screen.queryByLabelText("Hooks do Claude Code")?.textContent ?? "";
const dialog = () => screen.queryByRole("dialog")?.textContent ?? "";

async function setup() {
  const d = makeDaemon(cleanups);
  const server = d.listen();
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  await click("Abrir host alfa");
  await settle(() => hooksState().includes("ausentes"));
  return { ...d, store };
}

describe("hooks-ui", () => {
  test("a tela do host mostra o estado dos hooks; Instalar pede confirmação explicando o que será escrito", async () => {
    const { settingsFile, configFile, central } = await setup();
    expect(hooksState()).toContain("ausentes");
    await click("Instalar hooks");
    expect(dialog()).toContain(settingsFile);
    expect(dialog()).toContain("hooks do Flightdeck");
    await click("Cancelar");
    expect(existsSync(settingsFile)).toBe(false);
    await click("Instalar hooks");
    await click("Confirmar");
    await settle(() => hooksState().includes("instalados"));
    expect(hooksState()).toContain("instalados");
    const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
    const url = central.receptorUrl() ?? "";
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:[1-9]\d*$/);
    expect(settings.hooks.Stop[0].hooks[0].url).toBe(`${url}/hooks/Stop`);
    const token = loadConfig(configFile).hooks.token ?? "";
    expect(settings.hooks.Stop[0].hooks[0].headers).toEqual({ Authorization: `Bearer ${token}` });
  });

  test("Remover pede confirmação e tira só as entradas do Flightdeck", async () => {
    const { settingsFile } = await setup();
    await click("Instalar hooks");
    await click("Confirmar");
    await settle(() => hooksState().includes("instalados"));
    const before = JSON.parse(readFileSync(settingsFile, "utf8"));
    writeFileSync(settingsFile, JSON.stringify({ ...before, model: "opus" }));
    await click("Remover hooks");
    expect(dialog()).toContain(settingsFile);
    await click("Cancelar");
    expect(hooksState()).toContain("instalados");
    await click("Remover hooks");
    await click("Confirmar");
    await settle(() => hooksState().includes("ausentes"));
    expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toEqual({ model: "opus" });
  });

  test("hooks.install e hooks.uninstall sem confirm: true são recusados", async () => {
    const { store } = await setup();
    const hostId = store.getState().hosts[0]?.id ?? "";
    for (const type of ["hooks.install", "hooks.uninstall"] as const) {
      await act(async () => {
        expect(await store.hostCommand(hostId, type, {})).toBeNull();
      });
      expect(store.getState().error ?? "").toContain("confirm: true");
    }
  });

  test("um daemon que já tem hooks.token sobe o receptor e publica a URL; ao parar, apaga", async () => {
    const d = makeDaemon(cleanups);
    const dataDir = join(d.root, "outro-data");
    const central = new Central({
      db: d.eventStore.db,
      manager: d.manager,
      hooks: { port: 0, token: "t".repeat(24), permissionTimeoutS: 600, staleAfterS: 900 },
      dataDir,
      hostName: "h1",
      configFile: d.configFile,
      selfCommand: ["flightdeckd"],
      settingsPath: () => d.settingsFile,
    });
    expect(central.receptorUrl()).not.toBeNull();
    const published = join(dataDir, RECEPTOR_FILE);
    expect(existsSync(published) ? JSON.parse(readFileSync(published, "utf8")).url : null).toBe(
      central.receptorUrl(),
    );
    expect((await fetch(`${central.receptorUrl()}/health`)).status).toBe(200);
    // Its receptor feeds the external sessions and skips the daemon's own sessions.
    const { sessionId } = d.manager.create({ cwd: d.project, prompt: "oi" });
    const managed = await poll(() => d.manager.get(sessionId).claudeSessionId);
    for (const id of ["externa", managed ?? ""]) {
      await fetch(`${central.receptorUrl()}/hooks/UserPromptSubmit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${"t".repeat(24)}` },
        body: JSON.stringify({ session_id: id, cwd: d.project }),
      });
    }
    expect(central.external.list().map((s) => s.claudeSessionId)).toEqual(["externa"]);
    await central.stop();
    expect(existsSync(published)).toBe(false);
  });
});
