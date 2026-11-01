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

const click = async (name: string | RegExp, scope: HTMLElement | null = null) => {
  const button = (scope ? within(scope) : screen).queryByRole("button", { name });
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

const ONE = { id: "r1", match: { requester: "claude" }, decision: "allow" };
const TWO = { id: "r2", match: { requester: "automation" }, decision: "deny" };

/** The vault screen with the secret `deploy`, allowed on a host with actions. */
async function open(rules: unknown[] = []) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push("actions");
  const hostId = await store.addHost({ name: "box", url: daemon.url, token: TOKEN });
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  const deploy = await store.addSecret({
    name: "deploy",
    type: "token",
    value: "editor-value",
    allowedHosts: [hostId],
  });
  if (rules.length > 0) await store.setVaultRules(deploy.id, rules);
  render(<VaultPage store={store} />);
  await click("Regras de deploy");
  const editor = () => screen.queryByRole("region", { name: "Regras de deploy" });
  expect(editor()).not.toBeNull();
  return { store, daemon, deploy, editor };
}

describe("regras-ui-editor: the rules of a secret", () => {
  test("a new rule with who, the action and the decision is saved in order and handed to the host", async () => {
    const { store, daemon, deploy, editor } = await open();
    expect(
      within(editor() as HTMLElement).queryByText("Nenhuma regra: valem os padrões"),
    ).not.toBeNull();
    await click("Adicionar regra");
    await change("Quem pede na regra 1", "claude");
    await change("Ação na regra 1", "deploy-staging");
    await change("Decisão na regra 1", "allow");
    await click("Salvar regras", editor());
    await settle(() => editor() === null);
    expect(store.vaultRules(deploy.id)).toEqual([
      { id: "r1", match: { requester: "claude", action: "deploy-staging" }, decision: "allow" },
    ]);
    expect(daemon.commands.filter((c) => c.type === "vault.rules.set")).toHaveLength(1);
  });

  test("what the daemon refuses shows its reason, and the editor stays open with nothing saved", async () => {
    const { store, daemon, deploy, editor } = await open();
    daemon.refuse.set("vault.rules.set", "regra r1: allow para run_with_secret nunca é permitido");
    await click("Adicionar regra");
    await change("Finalidade na regra 1", "run_with_secret");
    await change("Decisão na regra 1", "allow");
    await click("Salvar regras", editor());
    await settle(() => within(editor() as HTMLElement).queryByRole("alert") !== null);
    expect(within(editor() as HTMLElement).queryByRole("alert")?.textContent).toBe(
      "O host recusou o pedido. regra r1: allow para run_with_secret nunca é permitido",
    );
    expect(store.vaultRules(deploy.id)).toEqual([]);
  });

  test("the order changes with Descer and Subir and by dragging, and a rule can be removed", async () => {
    const { store, deploy, editor } = await open([ONE, TWO]);
    await click("Descer regra 1");
    await click("Salvar regras", editor());
    await settle(() => editor() === null);
    expect(store.vaultRules(deploy.id)).toEqual([TWO, ONE]);
    await click("Regras de deploy");
    await click("Subir regra 2");
    const [first, second] = within(editor() as HTMLElement).getAllByRole("group", {
      name: /^Regra \d$/,
    });
    // Dragging the first onto the second puts it back after it.
    await act(async () => {
      fireEvent.dragStart(first as HTMLElement);
      fireEvent.dragOver(second as HTMLElement);
      fireEvent.drop(second as HTMLElement);
    });
    await click("Remover regra 2");
    await click("Salvar regras", editor());
    await settle(() => editor() === null);
    expect(store.vaultRules(deploy.id)).toEqual([TWO]);
  });

  test("once per session shows only with ask, and a window takes days, times and what holds outside it", async () => {
    const { store, deploy, editor } = await open();
    await click("Adicionar regra");
    expect(screen.queryByLabelText("Uma vez por sessão na regra 1")).not.toBeNull();
    await change("Decisão na regra 1", "deny");
    expect(screen.queryByLabelText("Uma vez por sessão na regra 1")).toBeNull();
    await change("Decisão na regra 1", "ask");
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Uma vez por sessão na regra 1"));
      fireEvent.click(screen.getByLabelText("seg na regra 1"));
      // A day checked and unchecked again is not in the window.
      fireEvent.click(screen.getByLabelText("sex na regra 1"));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("sex na regra 1"));
    });
    await change("Tags na regra 1", "prod");
    await change("Das na regra 1", "08:00");
    await change("Até na regra 1", "18:00");
    await change("Fora da janela na regra 1", "deny");
    await change("Máximo por hora na regra 1", "3");
    await click("Salvar regras", editor());
    await settle(() => editor() === null);
    expect(store.vaultRules(deploy.id)).toEqual([
      {
        id: "r1",
        match: { tags: ["prod"] },
        decision: "ask",
        once: "session",
        window: { days: ["mon"], from: "08:00", to: "18:00" },
        outsideWindow: "deny",
        maxPerHour: 3,
      },
    ]);
  });

  test("Cancelar closes it without saving", async () => {
    const { store, deploy, editor } = await open();
    await click("Adicionar regra");
    await click("Cancelar", editor());
    expect(editor()).toBeNull();
    expect(store.vaultRules(deploy.id)).toEqual([]);
  });
});
