import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

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
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const click = async (name: string | RegExp) => {
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

/** The host page of a daemon with telemetry; `settings` is what the user already has. */
async function open(options: { telemetry?: boolean; settings?: object } = {}) {
  const d = makeDaemon(cleanups, { telemetry: options.telemetry ?? true });
  if (options.settings) {
    mkdirSync(dirname(d.settingsFile), { recursive: true });
    writeFileSync(d.settingsFile, JSON.stringify(options.settings));
  }
  const server = d.listen();
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "alfa", url: server.url, token: TOKEN }));
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  await act(async () => {
    store.router.push({ name: "host", host: hostId });
  });
  return { d, store };
}

const panel = () => screen.queryByRole("region", { name: "Telemetria" });
const settings = (d: { settingsFile: string }) =>
  existsSync(d.settingsFile) ? JSON.parse(readFileSync(d.settingsFile, "utf8")) : null;

describe("otlp-app: Telemetria on the host page", () => {
  test("a host that does not offer telemetry has no such panel", async () => {
    await open({ telemetry: false });
    await settle(() => screen.queryByText("Hooks do Claude Code") !== null);
    expect(panel()).toBeNull();
  });

  test("install asks first, says it edits settings.json and keeps a copy, then shows it installed; remove takes it out", async () => {
    const { d } = await open({ settings: { model: "opus" } });
    await settle(() => panel() !== null && (panel()?.textContent ?? "").includes("Não instalada"));
    expect(panel()?.textContent).toContain("Não instalada");
    await click("Instalar telemetria");
    const dialog = screen.queryByRole("alertdialog");
    expect(dialog?.textContent).toContain(d.settingsFile);
    expect(dialog?.textContent).toContain("cópia");
    expect(dialog?.textContent).toContain("nunca");
    // Cancelling writes nothing.
    await click("Cancelar");
    expect(settings(d)).toEqual({ model: "opus" });
    await click("Instalar telemetria");
    await act(async () => {
      fireEvent.click(
        within(screen.queryByRole("alertdialog") as HTMLElement).getByRole("button", {
          name: "Instalar telemetria",
        }),
      );
    });
    await settle(() => (panel()?.textContent ?? "").includes("Instalada"));
    expect(panel()?.textContent).toContain("Instalada");
    expect(settings(d).env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("1");
    expect(settings(d).model).toBe("opus");

    await click("Remover telemetria");
    await act(async () => {
      fireEvent.click(
        within(screen.queryByRole("alertdialog") as HTMLElement).getByRole("button", {
          name: "Remover telemetria",
        }),
      );
    });
    await settle(() => (panel()?.textContent ?? "").includes("Não instalada"));
    expect(settings(d)).toEqual({ model: "opus" });
  });

  test("a user's own exporter is named in the panel, and install is refused in the app's language with nothing written", async () => {
    const mine = { env: { OTEL_LOGS_EXPORTER: "console" } };
    const { d, store } = await open({ settings: mine });
    await settle(() => (panel()?.textContent ?? "").includes("OTEL_LOGS_EXPORTER"));
    expect(panel()?.textContent).toContain("exportador seu");
    expect(panel()?.textContent).toContain("OTEL_LOGS_EXPORTER");
    await click("Instalar telemetria");
    await act(async () => {
      fireEvent.click(
        within(screen.queryByRole("alertdialog") as HTMLElement).getByRole("button", {
          name: "Instalar telemetria",
        }),
      );
    });
    await settle(() => store.getState().notices.length > 0);
    expect(store.getState().notices[0]).toMatchObject({
      reason: "telemetry_owned_keys",
      params: { keys: "OTEL_LOGS_EXPORTER" },
    });
    await settle(() => screen.queryByText(/já define OTEL_LOGS_EXPORTER/) !== null);
    expect(screen.queryByText(/já define OTEL_LOGS_EXPORTER/)).not.toBeNull();
    expect(settings(d)).toEqual(mine);
  });
});
