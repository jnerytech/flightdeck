import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
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

describe("regras-ui-aprovacao: Criar regra a partir disto", () => {
  test("the card of a request opens the secret's rules with a new rule for who asked, why and the action, and leaves the request waiting", async () => {
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    const daemon = legacyDaemon(cleanups);
    render(<App store={store} />);
    const hostId = await act(() => store.addHost({ name: "alfa", url: daemon.url, token: TOKEN }));
    await settle(() => daemon.asked.includes("vault.watch"));
    const secret = await act(() =>
      store.addSecret({ name: "prod-key", type: "token", value: "v", allowedHosts: [hostId] }),
    );
    await act(async () => {
      store.router.push({ name: "needs-you" });
      daemon.push({
        type: "vault.request",
        requestId: "r1",
        secretId: secret.id,
        purpose: "action:deploy:r1",
        requester: "claude",
        action: "deploy",
        params: {},
        approval: "always",
        decision: "ask",
        reason: "padrão",
      });
    });
    await settle(() => needsYou(store.getState()).length === 1);
    await click(/alfa · Pedido de Claude: deploy/);
    await click("Criar regra a partir disto");
    await settle(() => screen.queryByRole("region", { name: "Regras de prod-key" }) !== null);
    const value = (label: string) => (screen.queryByLabelText(label) as HTMLInputElement).value;
    expect(value("Quem pede na regra 1")).toBe("claude");
    expect(value("Finalidade na regra 1")).toBe("action");
    expect(value("Ação na regra 1")).toBe("deploy");
    expect(needsYou(store.getState())).toHaveLength(1);
    expect(daemon.commands.some((c) => c.type === "vault.deny")).toBe(false);
  });
});
