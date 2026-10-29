import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../daemon/src/config.ts";
import { lastTool, requestLine } from "../../daemon/src/history/session-line.ts";
import { poll } from "../../daemon/test/helpers.ts";
import { userLine, writeTranscript } from "../../daemon/test/history-helpers.ts";
import { sessionLineText } from "../src/lib/hub.ts";
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

const row = (title: string) => screen.queryByRole("listitem", { name: title })?.textContent ?? "";

/** An assistant line that calls `tool`, as Claude Code writes it. */
const toolLine = (uuid: string, tool: string, cwd: string, ts: string) =>
  JSON.stringify({
    cwd,
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "vou rodar" },
        { type: "tool_use", id: `t-${uuid}`, name: tool, input: {} },
      ],
    },
    uuid,
    timestamp: ts,
  });

const NOW = Date.parse("2026-10-29T12:00:00.000Z");

describe("resumo-lista", () => {
  test("pedido: primeira linha não vazia do prompt, cortada em 80 caracteres", () => {
    expect(requestLine("  \n  rode os testes  \nsegunda linha")).toBe("rode os testes");
    expect(requestLine("a".repeat(100))).toBe(`${"a".repeat(79)}…`);
    expect(requestLine("a".repeat(100)).length).toBe(80);
    expect(requestLine("b".repeat(80))).toBe("b".repeat(80));
    expect(lastTool("vou ver\n[ferramenta Read]\nagora\n[ferramenta Bash]")).toBe("Bash");
    expect(lastTool("só texto")).toBeNull();
  });

  test("estado: rodando com a ferramenta, esperando aprovação, ociosa há N min; encerrada só com o pedido", () => {
    const line = (patch: object) => ({
      request: "rode os testes",
      state: "running" as const,
      tool: "Bash",
      since: null,
      ...patch,
    });
    expect(sessionLineText(line({}), NOW)).toBe("Pedido: rode os testes · rodando Bash");
    expect(sessionLineText(line({ request: null, tool: null }), NOW)).toBe("rodando");
    expect(sessionLineText(line({ state: "waiting", tool: "Write" }), NOW)).toBe(
      "Pedido: rode os testes · esperando aprovação de Write",
    );
    const idle = (since: string) => line({ state: "idle", tool: null, since });
    expect(sessionLineText(idle("2026-10-29T11:48:00.000Z"), NOW)).toBe(
      "Pedido: rode os testes · ociosa há 12 min",
    );
    expect(sessionLineText(idle("2026-10-29T11:59:30.000Z"), NOW)).toBe(
      "Pedido: rode os testes · ociosa há menos de 1 min",
    );
    expect(sessionLineText(idle("2026-10-29T09:30:00.000Z"), NOW)).toBe(
      "Pedido: rode os testes · ociosa há 2 h",
    );
    expect(sessionLineText(line({ state: "ended", tool: null }), NOW)).toBe(
      "Pedido: rode os testes",
    );
    expect(sessionLineText(line({ state: "ended", request: null }), NOW)).toBe("");
    expect(sessionLineText(undefined, NOW)).toBe("");
  });

  test("summary nas listas: terminal rodando, terminal esperando, gerenciada ociosa e histórico", async () => {
    const d = makeDaemon(cleanups);
    const appA = join(d.root, "app-a");
    const appB = join(d.root, "app-b");
    mkdirSync(appA);
    mkdirSync(appB);
    const { sessionId } = d.manager.create({ cwd: d.project, prompt: "oi", name: "Gerenciada" });
    await poll(() => d.manager.get(sessionId).status === "idle");
    const managed = d.manager.get(sessionId);
    const ts = new Date().toISOString();
    writeTranscript(d.historyRoot, "-p", managed.claudeSessionId ?? "", [
      userLine({ uuid: "m1", text: "corrija o build\ncom calma", cwd: d.project, ts }),
    ]);

    d.central.hooksInstall(true);
    const hooksToken = loadConfig(d.configFile).hooks.token ?? "";
    const receptor = d.central.receptorUrl() ?? "";
    const hook = (session: string, event: string, body: Record<string, unknown>) =>
      fetch(`${receptor}/hooks/${event}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${hooksToken}` },
        body: JSON.stringify({ session_id: session, hook_event_name: event, ...body }),
      }).then((r) => r.text());
    await hook("ext-1", "SessionStart", { cwd: appA, source: "startup" });
    await hook("ext-1", "UserPromptSubmit", { prompt: "rode os testes" });
    writeTranscript(d.historyRoot, "-app-a", "ext-1", [
      userLine({ uuid: "a1", text: "rode os testes", cwd: appA, ts }),
      toolLine("a2", "Bash", appA, ts),
    ]);
    await hook("ext-2", "SessionStart", { cwd: appB, source: "startup" });
    await hook("ext-2", "UserPromptSubmit", { prompt: "apague o rascunho" });
    writeTranscript(d.historyRoot, "-app-b", "ext-2", [
      userLine({ uuid: "b1", text: "apague o rascunho", cwd: appB, ts }),
    ]);
    const old = writeTranscript(d.historyRoot, "-old", "hist-1", [
      userLine({
        uuid: "h1",
        text: "Do histórico",
        cwd: d.project,
        ts: "2026-09-01T10:00:00.000Z",
      }),
    ]);
    utimesSync(old, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
    d.history.scan();

    const idleSince = Date.parse(managed.updatedAt);
    const store = new AppStore(memoryPlatform().platform, {
      baseDelayMs: 60_000,
      now: () => idleSince + 12 * 60_000,
    });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts.every((h) => h.status === "online"));
    // Held by the receptor (only while an app watches) until answered: the session waits for Write.
    await settle(() => Object.keys(store.getState().externals).length === 2);
    void hook("ext-2", "PermissionRequest", { tool_name: "Write", tool_input: {} }).catch(() => {});
    const open = screen.queryByRole("button", { name: "Abrir Sessões" });
    expect(open).not.toBeNull();
    await act(async () => {
      fireEvent.click(open as HTMLElement);
    });
    await settle(() => row("app-b").includes("esperando"));

    // The lists carry it as data.
    const hub = Object.values(store.getState().hub)[0];
    expect(hub?.history.find((s) => s.claudeSessionId === "hist-1")?.summary).toEqual({
      request: "Do histórico",
      state: "ended",
      tool: null,
      since: "2026-09-01T10:00:00.000Z",
    });
    expect(hub?.managed[0]?.summary).toEqual({
      request: "corrija o build",
      state: "idle",
      tool: null,
      since: managed.updatedAt,
    });
    // And each row shows it.
    expect(row("app-a")).toContain("Pedido: rode os testes · rodando Bash");
    expect(row("app-b")).toContain("Pedido: apague o rascunho · esperando aprovação de Write");
    expect(row("Gerenciada")).toContain("Pedido: corrija o build · ociosa há 12 min");
    expect(row("Do histórico")).toContain("Pedido: Do histórico");
  });

  test("a linha da sessão gerenciada acompanha o estado ao vivo, sem esperar a lista", async () => {
    const d = makeDaemon(cleanups);
    const { sessionId } = d.manager.create({ cwd: d.project, prompt: "oi", name: "Viva" });
    await poll(() => d.manager.get(sessionId).status === "idle");
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
    });
    await settle(() => store.getState().hosts.every((h) => h.status === "online"));
    const open = screen.queryByRole("button", { name: "Abrir Sessões" });
    expect(open).not.toBeNull();
    await act(async () => {
      fireEvent.click(open as HTMLElement);
    });
    await settle(() => row("Viva").includes("ociosa"));
    expect(row("Viva")).toContain("ociosa");

    // A new turn asks for Bash: the badge and the line say the same thing.
    d.manager.send(sessionId, "[bash]");
    await poll(() => d.manager.pendingPermissions(sessionId).length === 1);
    await settle(() => row("Viva").includes("precisa de você"));
    expect(row("Viva")).toContain("precisa de você");
    expect(row("Viva")).toContain("esperando aprovação de Bash");
    expect(row("Viva")).not.toContain("ociosa");
  });
});
