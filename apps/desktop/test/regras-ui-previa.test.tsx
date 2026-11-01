import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { legacyDaemon } from "./legacy-daemon.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { VaultPage } = await import("../src/ui/VaultPage.tsx");

setDefaultTimeout(20_000);

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
const change = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label) as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};

/** The editor of the secret `prod-key` (tag prod), allowed on a host with actions, or on none. */
async function open(allowed = true) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push("actions");
  const hostId = await store.addHost({ name: "box", url: daemon.url, token: TOKEN });
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  const secret = await store.addSecret({
    name: "prod-key",
    type: "token",
    value: "preview-value",
    tags: ["prod"],
    allowedHosts: allowed ? [hostId] : [],
  });
  render(<VaultPage store={store} />);
  await click("Regras de prod-key");
  const result = () => screen.queryByRole("status", { name: "Resultado da prévia" });
  return { store, daemon, secret, result };
}

describe("regras-ui-previa: what happens if…", () => {
  test("Prever asks a host what the saved rules decide for a use, with the secret's tags, and says it", async () => {
    const { daemon, secret, result } = await open();
    daemon.preview.verdict = {
      decision: "allow",
      ruleId: "r1",
      reason: "regra r1: allow",
      once: false,
      needsHold: false,
      limited: false,
    };
    await change("Quem pede na prévia", "claude");
    await change("Finalidade na prévia", "action");
    await change("Ação na prévia", "deploy-staging");
    await click("Prever");
    await settle(() => result() !== null);
    expect(daemon.commands.find((c) => c.type === "vault.rules.preview")?.payload).toEqual({
      secretId: secret.id,
      requester: "claude",
      purpose: "action",
      action: "deploy-staging",
      tags: ["prod"],
    });
    expect(result()?.textContent).toContain("Permitir");
    expect(result()?.textContent).toContain("regra r1: allow");
  });

  test("the answer says when it asks once per session, when the button is held and when a limit was hit", async () => {
    const { daemon, result } = await open();
    daemon.preview.verdict = {
      decision: "ask",
      ruleId: "r2",
      reason: "prod",
      once: true,
      needsHold: true,
      limited: true,
    };
    await click("Prever");
    await settle(() => result() !== null);
    for (const part of [
      "Perguntar",
      "uma vez por sessão",
      "segurar o botão por 2 s",
      "limite atingido",
    ]) {
      expect(result()?.textContent).toContain(part);
    }
  });

  test("with no connected host the secret may go to, the preview says so", async () => {
    const { daemon, result } = await open(false);
    await click("Prever");
    await settle(() => result() !== null);
    expect(result()?.textContent).toContain("Nenhum host conectado");
    expect(daemon.commands.some((c) => c.type === "vault.rules.preview")).toBe(false);
  });
});
