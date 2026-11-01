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

const VALUE = "usage-ui-value-0123456789";

async function settle(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await Bun.sleep(10);
}

/** Two secrets, and a daemon that asked for both and reported one use. */
async function open(requests = true) {
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  const daemon = legacyDaemon(cleanups);
  await store.addHost({ name: "box", url: daemon.url, token: TOKEN });
  await settle(() => store.getState().hosts.every((h) => h.status === "online"));
  await settle(() => daemon.asked.includes("external.watch"));
  const github = await store.addSecret({ name: "github", type: "token", value: VALUE });
  const deploy = await store.addSecret({ name: "deploy", type: "password", value: VALUE });
  if (requests) {
    daemon.push({
      type: "vault.request",
      requestId: "r1",
      secretId: github.id,
      purpose: "ssh",
      requester: "claude",
    });
    daemon.push({
      type: "vault.request",
      requestId: "r2",
      secretId: deploy.id,
      purpose: "release",
      requester: "automation",
    });
    daemon.push({
      type: "vault.used",
      secretId: github.id,
      purpose: "ssh",
      requester: "claude",
      action: "ssh deploy@box",
      at: "2026-10-30T10:00:00.000Z",
    });
    await settle(() => store.getState().vaultUsage.length === 3);
  }
  render(<VaultPage store={store} />);
  const tab = screen.queryByRole("tab", { name: "Uso" });
  expect(tab).not.toBeNull();
  await act(async () => {
    fireEvent.mouseDown(tab as HTMLElement, { button: 0 });
    fireEvent.click(tab as HTMLElement);
  });
  return { store };
}

const lines = () => {
  const list = screen.queryByRole("list", { name: "Registro de uso" });
  return list ? within(list).queryAllByRole("listitem") : [];
};

const choose = async (label: string, value: string) => {
  const field = screen.queryByLabelText(label);
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLElement, { target: { value } });
  });
};

describe("cofre-ui: usage log", () => {
  test("the Uso tab lists each line with the secret's name, host, purpose, requester and result", async () => {
    await open();
    expect(lines()).toHaveLength(3);
    const text = lines().map((line) => line.textContent ?? "");
    const denied = text.find((t) => t.includes("release"));
    expect(denied).toContain("deploy");
    expect(denied).toContain("box");
    expect(denied).toContain("Automação");
    expect(denied).toContain("Negado");
    const used = text.find((t) => t.includes("ssh deploy@box"));
    expect(used).toContain("github");
    expect(used).toContain("Claude");
    expect(used).toContain("Usado");
  });

  test("an empty log says so", async () => {
    await open(false);
    expect(screen.queryByText("Nenhum uso registrado.")).not.toBeNull();
  });

  test("the filters narrow the lines by secret and by who asked", async () => {
    await open();
    const github = screen.queryByRole("option", { name: "github" }) as HTMLOptionElement | null;
    expect(github).not.toBeNull();
    await choose("Segredo", github?.value ?? "");
    expect(lines()).toHaveLength(2);
    await choose("Quem pediu", "automation");
    expect(screen.queryByText("Nenhum uso registrado.")).not.toBeNull();
    await choose("Segredo", "");
    expect(lines()).toHaveLength(1);
  });

  test("no line shows a value", async () => {
    await open();
    expect(document.body.innerHTML).not.toContain(VALUE);
  });
});
