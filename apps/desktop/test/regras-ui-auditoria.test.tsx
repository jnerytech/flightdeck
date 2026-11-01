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

/** A store on a daemon with actions, with the secret `deploy` allowed there. */
async function setup() {
  const mem = memoryPlatform();
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  const daemon = legacyDaemon(cleanups);
  daemon.features.push("actions");
  const hostId = await store.addHost({ name: "box", url: daemon.url, token: TOKEN });
  await settle(() => store.getState().hosts[0]?.hostInfo != null);
  const deploy = await store.addSecret({
    name: "deploy",
    type: "token",
    value: "audit-value",
    allowedHosts: [hostId],
  });
  return { store, daemon, hostId, deploy, mem };
}

/** The vault screen on its Relatório tab. */
async function report(store: InstanceType<typeof AppStore>) {
  render(<VaultPage store={store} />);
  const tab = screen.queryByRole("tab", { name: "Relatório" });
  expect(tab).not.toBeNull();
  await act(async () => {
    fireEvent.mouseDown(tab as HTMLElement, { button: 0 });
    fireEvent.click(tab as HTMLElement);
  });
}

describe("regras-ui-auditoria: what the rules decided", () => {
  test("a vault.alert of the daemon notifies and stays as a notice, even where a rule allowed the use", async () => {
    const { store, daemon, deploy, mem } = await setup();
    const message = "primeiro uso de deploy por automation";
    daemon.push({
      type: "vault.alert",
      kind: "new-requester",
      secretId: deploy.id,
      requester: "automation",
      message,
      at: "2026-10-30T12:00:00.000Z",
    });
    await settle(() => store.getState().notices.some((n) => n.text === message));
    expect(store.getState().notices.map((n) => n.text)).toContain(message);
    expect(mem.notifications).toContainEqual({ title: "Alerta do cofre", body: message });
  });

  test("Relatório lists the uses of the last 30 days by secret, requester and outcome, with the secret's name", async () => {
    const { store, daemon, deploy } = await setup();
    daemon.audit.rows = [
      { secretId: deploy.id, requester: "claude", outcome: "allowed", count: 4 },
      { secretId: deploy.id, requester: "automation", outcome: "denied", count: 1 },
    ];
    await report(store);
    const table = () => screen.queryByRole("table", { name: "Usos do cofre por segredo" });
    await settle(
      () =>
        table() !== null &&
        (table()?.textContent ?? "").includes("automation") === false &&
        (table()?.textContent ?? "").includes("Automação"),
    );
    expect(daemon.commands.find((c) => c.type === "vault.report")?.payload).toEqual({ days: 30 });
    const text = table()?.textContent ?? "";
    for (const part of ["deploy", "Claude", "deixou passar", "4", "Automação", "negado", "1"]) {
      expect(text).toContain(part);
    }
  });

  test("Exportar CSV saves the daemon's CSV of the same period", async () => {
    const { store, daemon, mem } = await setup();
    daemon.audit.csv = "secret,requester,outcome,count\ndeploy,claude,allowed,4\n";
    await report(store);
    await click("Exportar CSV");
    await settle(() => mem.saved.length > 0);
    expect(mem.saved).toEqual([{ name: "flightdeck-cofre-30-dias.csv", text: daemon.audit.csv }]);
    expect(
      daemon.commands.some(
        (c) => c.type === "vault.report" && (c.payload as { format?: string }).format === "csv",
      ),
    ).toBe(true);
  });

  test("the decisions list shows each request with the rule's reason, the outcome and who let it through", async () => {
    const { store, daemon, deploy } = await setup();
    daemon.audit.decisions = [
      {
        id: "d1",
        at: "2026-10-30T12:00:00.000Z",
        secretId: deploy.id,
        requester: "claude",
        purpose: "action",
        action: "deploy-staging",
        host: "box",
        project: null,
        session: null,
        ruleId: "r1",
        decision: "allow",
        outcome: "allowed",
        approver: "rule",
        window: null,
        reason: "regra r1: allow",
      },
    ];
    await report(store);
    const list = () => screen.queryByRole("list", { name: "Decisões do cofre" });
    await settle(() => (list()?.children.length ?? 0) === 1);
    const row = list()?.textContent ?? "";
    for (const part of [
      "deploy",
      "deploy-staging",
      "Claude",
      "regra r1: allow",
      "deixou passar",
      "regra",
    ]) {
      expect(row).toContain(part);
    }
  });

  test("with no host that has actions, the report says so", async () => {
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    cleanups.push(() => store.dispose());
    await report(store);
    expect(screen.queryByText("Nenhum host conectado com ações")).not.toBeNull();
  });

  test("with two hosts that have actions, the report is the chosen host's", async () => {
    const { store, daemon } = await setup();
    const other = legacyDaemon(cleanups);
    other.features.push("actions");
    await store.addHost({ name: "pi", url: other.url, token: TOKEN });
    await settle(() => store.getState().hosts.every((h) => h.hostInfo != null));
    await report(store);
    await settle(() => daemon.asked.includes("vault.report"));
    const select = screen.queryByLabelText("Host") as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    await act(async () => {
      fireEvent.change(select as HTMLSelectElement, {
        target: { value: store.getState().hosts[1]?.id },
      });
    });
    await settle(() => other.asked.includes("vault.report"));
    expect(other.asked).toContain("vault.decisions");
  });
});
