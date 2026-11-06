import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ExternalSession, ExternalStatus } from "@flightdeck/protocol";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TerminalButton } = await import("../src/ui/TerminalButton.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { liveElsewhere } = await import("../src/lib/live-elsewhere.ts");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(4000);

const external = (claudeSessionId: string, status: ExternalStatus): ExternalSession => ({
  claudeSessionId,
  cwd: "/repo",
  transcriptPath: null,
  source: "resume",
  status,
  statusReason: null,
  launchId: null,
  controllable: false,
  projectKey: null,
  startedAt: "2026-11-06T12:00:00Z",
  lastEventAt: "2026-11-06T12:00:00Z",
  endedAt: status === "ended" ? "2026-11-06T12:05:00Z" : null,
});

async function setup(language: "en" | "pt-BR", status: ExternalStatus | null) {
  const d = makeDaemon(cleanups, { terminals: true });
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 60_000 });
  store.i18n.start();
  cleanups.push(() => store.dispose());
  const hostId = await store.addHost({ name: "pc", url: d.listen().url, token: TOKEN });
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  if (status) {
    // What external.watch brings: the same session, run by another `claude` (VS Code's terminal).
    (store as unknown as { update(patch: object): void }).update({
      externals: { [`${hostId}/abc-123`]: external("abc-123", status) },
    });
  }
  render(
    <TContext.Provider value={store.i18n.t}>
      <TerminalButton store={store} hostId={hostId} target={{ cwd: d.root, claudeSessionId: "abc-123" }} />
    </TContext.Provider>,
  );
  return { ...d, store, hostId };
}

const click = async (name: string | RegExp) => {
  const target = screen.queryByRole("button", { name });
  expect(target).not.toBeNull();
  await act(async () => {
    if (target) fireEvent.click(target);
  });
};

describe("terminal-ao-vivo: a session already live in another terminal (#502)", () => {
  test("liveElsewhere finds a running, idle or waiting session of that host, never an ended or unknown one", () => {
    const of = (status: ExternalStatus) => ({ "h1/abc": external("abc", status) });
    for (const status of ["running", "idle", "awaiting_permission"] as const) {
      expect(liveElsewhere(of(status), "h1", "abc")?.status, status).toBe(status);
    }
    for (const status of ["ended", "unknown"] as const) {
      expect(liveElsewhere(of(status), "h1", "abc"), status).toBeNull();
    }
    expect(liveElsewhere(of("running"), "h2", "abc")).toBeNull();
    expect(liveElsewhere(of("running"), "h1", "other")).toBeNull();
  });

  test("resuming it here asks first, starts nothing, and View it live here opens the session's live view", async () => {
    const { store, hostId, ptys } = await setup("en", "running");
    await click("Continue in the terminal");
    expect(screen.queryByText("Already open in another terminal")).not.toBeNull();
    expect(ptys.spawned).toHaveLength(0);
    await click("View it live here");
    expect(store.router.current).toEqual({ name: "external", host: hostId, claudeSessionId: "abc-123" });
    expect(ptys.spawned).toHaveLength(0);
  });

  test("Abrir outra cópia mesmo assim starts the second copy, with --resume (pt-BR)", async () => {
    const { ptys } = await setup("pt-BR", "awaiting_permission");
    await click("Continuar no terminal");
    expect(screen.queryByText("Já aberta em outro terminal")).not.toBeNull();
    await click("Abrir outra cópia mesmo assim");
    await settle(() => ptys.spawned.length === 1);
    expect(ptys.spawned[0]?.argv).toContain("--resume");
    expect(ptys.spawned[0]?.argv).toContain("abc-123");
  });

  test("the outside terminal asks the same before it opens or copies anything", async () => {
    await setup("pt-BR", "idle");
    await click(/Copiar comando|Abrir no terminal/);
    expect(screen.queryByText("Já aberta em outro terminal")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Ver ao vivo aqui" })).not.toBeNull();
  });

  test("a session that ended elsewhere, or that nobody runs, opens at once", async () => {
    for (const status of ["ended", null] as const) {
      const { ptys } = await setup("pt-BR", status);
      await click("Continuar no terminal");
      expect(screen.queryByText("Já aberta em outro terminal")).toBeNull();
      await settle(() => ptys.spawned.length === 1);
      cleanup();
    }
  });
});
