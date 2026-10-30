import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore, needsYou } = await import("../src/lib/app-store.ts");
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

/** The app on a fake daemon, on Precisa de você, with a request of the daemon in the queue. */
async function queued(over: Record<string, unknown>) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
  await settle(() => daemon.asked.includes("vault.watch"));
  const meta = await act(() =>
    store.addSecret({
      name: "deploy",
      type: "token",
      value: "ui-value-123",
      allowedHosts: [hostId],
    }),
  );
  await act(async () => {
    store.router.push({ name: "needs-you" });
  });
  await act(async () => {
    daemon.push({
      type: "vault.request",
      requestId: "r1",
      secretId: meta.id,
      purpose: "action:deploy-staging:r1",
      requester: "claude",
      action: "deploy-staging",
      params: { branch: "main" },
      approval: "always",
      ...over,
    });
  });
  await settle(() => needsYou(store.getState()).length === 1);
  const sent = (type: string) => daemon.commands.filter((c) => c.type === type);
  return { store, daemon, sent };
}

describe("acoes-ui-aprovacao: the card of a request for a secret", () => {
  test("an action request is a row of the queue whose card shows what it runs, with Aprovar and Negar and no session to open", async () => {
    const { sent } = await queued({});
    await click(/alfa · Pedido de Claude: deploy-staging/);
    const card = screen.queryByRole("group", { name: /deploy-staging/ }) as HTMLElement;
    for (const part of ["deploy-staging", "Segredo", "deploy", "Parâmetro branch", "main"]) {
      expect(card.textContent).toContain(part);
    }
    expect(within(card).queryByRole("button", { name: "Abrir sessão" })).toBeNull();
    await click("Aprovar");
    await settle(() => sent("vault.deliver").length === 1);
    expect(sent("vault.deliver")).toHaveLength(1);
  });

  test("Negar refuses the request and tells the daemon", async () => {
    const { sent } = await queued({});
    await click(/alfa · Pedido de Claude: deploy-staging/);
    await click("Negar");
    await click("Negar");
    await settle(() => sent("vault.deny").length === 1);
    expect(sent("vault.deny")[0]?.payload).toEqual({ requestId: "r1" });
    expect(sent("vault.deliver")).toEqual([]);
  });

  test("a free command shows the command, the secrets and the host, and is approved only by holding the button", async () => {
    await queued({
      action: undefined,
      params: undefined,
      approval: undefined,
      command: "make deploy",
      secrets: ["deploy"],
      host: "alfa",
    });
    await click(/alfa · Pedido de Claude: run_with_secret/);
    const card = screen.queryByRole("group", { name: /run_with_secret/ }) as HTMLElement;
    for (const part of ["make deploy", "Segredos", "deploy", "alfa"]) {
      expect(card.textContent).toContain(part);
    }
    expect(within(card).queryByRole("button", { name: /Segurar/ })).not.toBeNull();
    expect(within(card).queryByRole("button", { name: "Aprovar" })).toBeNull();
  });
});
