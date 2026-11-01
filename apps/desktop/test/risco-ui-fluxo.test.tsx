import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { EventEnvelope } from "@flightdeck/protocol";
import { RiskClassifier } from "../../daemon/src/permissions/risk.ts";
import type { TrayAction, TrayMenu } from "../src/platform/types.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";
import { waiter } from "./wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore, needsYou } = await import("../src/lib/app-store.ts");
const { applyEnvelope, emptySession } = await import("../src/lib/session-state.ts");
const { App } = await import("../src/ui/App.tsx");

setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const settle = waiter(4000);

/** The user's `risk.extraHigh` makes the fake runtime's `npm test --silent` a high-risk Bash. */
const risk = (root: string) =>
  new RiskClassifier({ allowedRoots: [root], home: root, extraHigh: ["npm test"] });

function trayPlatform() {
  const mem = memoryPlatform(false);
  const menus: TrayMenu[] = [];
  let handler: ((action: TrayAction) => void) | null = null;
  mem.platform.setTrayMenu = async (menu) => {
    menus.push(menu);
  };
  mem.platform.onTrayAction = (h) => {
    handler = h;
    return () => {
      handler = null;
    };
  };
  return { mem, menus, act: (action: TrayAction) => handler?.(action) };
}

/** A daemon with a session waiting for a high-risk Bash, and the app connected to it. */
async function waitingHigh() {
  const d = makeDaemon(cleanups, { risk });
  const server = d.listen();
  const created = d.manager.create({ cwd: d.project, prompt: "[bash]", name: "s-risco" });
  await waitFor(() => d.manager.get(created.sessionId).status === "awaiting_permission");
  const tray = trayPlatform();
  const store = new AppStore(tray.mem.platform, { baseDelayMs: 10 });
  cleanups.push(() => store.dispose());
  // The App starts the store, which is what listens to the tray.
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "pc", url: server.url, token: TOKEN });
  });
  await settle(() => needsYou(store.getState()).length === 1);
  return { d, store, tray, sessionId: created.sessionId };
}

const env = (seq: number, event: EventEnvelope["event"]): EventEnvelope => ({
  type: "event",
  sessionId: "s1",
  seq,
  ts: "2026-10-29T12:00:00.000Z",
  event,
});

describe("risco-ui: do daemon à tela", () => {
  test("o risco e o motivo vão do evento do pedido ao item da conversa, e a decisão automática à resolução", () => {
    let s = emptySession();
    s = applyEnvelope(
      s,
      env(1, {
        type: "permission.requested",
        requestId: "r1",
        toolName: "Bash",
        input: { command: "rm -rf build" },
        risk: "high",
        riskReason: "apaga arquivos de forma recursiva",
      }),
    );
    expect(s.items[0]).toMatchObject({
      kind: "permission",
      risk: "high",
      riskReason: "apaga arquivos de forma recursiva",
    });
    s = applyEnvelope(
      s,
      env(2, {
        type: "permission.resolved",
        requestId: "r1",
        decision: "allow",
        auto: { by: "ai", reason: "só lê a pasta", model: "claude-haiku-5-5" },
      }),
    );
    expect(s.items[0]).toMatchObject({
      resolution: {
        decision: "allow",
        auto: { by: "ai", reason: "só lê a pasta", model: "claude-haiku-5-5" },
      },
    });
  });

  test("a fila traz o risco do pedido, a bandeja só oferece Abrir e aprovar por ela apenas abre o pedido", async () => {
    const { d, store, tray, sessionId } = await waitingHigh();
    const [item] = needsYou(store.getState());
    expect(item).toMatchObject({ risk: "high", toolName: "Bash" });
    expect(typeof item?.riskReason).toBe("string");
    await settle(() => (tray.menus.at(-1)?.items.length ?? 0) === 1, 3000);
    expect(tray.menus.at(-1)?.items[0]?.actions).toEqual(["open"]);

    const opened: unknown[] = [];
    store.onOpenRequest((i) => opened.push(i));
    tray.act({ key: `${item?.hostId}/${item?.requestId}`, action: "approve" });
    await Bun.sleep(150);
    expect(opened).toHaveLength(1);
    expect(d.manager.get(sessionId).status).toBe("awaiting_permission");
  });

  test("na fila e na conversa o pedido alto mostra o selo e pede para segurar; segurar na conversa aprova", async () => {
    const { d, sessionId } = await waitingHigh();
    await sidebar.queueItem(/s-risco/);
    const inQueue = screen.getByRole("group", { name: "Pedido de Bash" });
    expect(within(inQueue).getByText("Risco alto")).toBeTruthy();
    expect(within(inQueue).queryByRole("button", { name: "Aprovar" })).toBeNull();
    expect(within(inQueue).getByRole("button", { name: "Segurar para aprovar" })).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Abrir sessão" }));
    });
    await settle(() => !!screen.queryByRole("group", { name: "Pedido de Bash" }));
    const inSession = screen.getByRole("group", { name: "Pedido de Bash" });
    expect(within(inSession).getByText("Risco alto")).toBeTruthy();
    const hold = within(inSession).getByRole("button", { name: "Segurar para aprovar" });
    await act(async () => {
      fireEvent.pointerDown(hold);
    });
    await act(() => Bun.sleep(2300));
    await waitFor(() => d.manager.get(sessionId).status !== "awaiting_permission");
    expect(d.manager.get(sessionId).status).not.toBe("awaiting_permission");
  });
});
