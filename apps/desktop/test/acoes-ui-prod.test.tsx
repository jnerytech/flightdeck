import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";
import { memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";
import { workflowDaemon } from "./workflow-fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

// Real git under the in-process daemon: more than the default 5 s.
setDefaultTimeout(30_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function settle(check: () => boolean, timeoutMs = 6000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await act(() => Bun.sleep(10));
}

const row = (name: string) => screen.queryByRole("listitem", { name: `Ação ${name}` });

/** A host with four actions: each secret is tagged prod or not, and each action runs here or by ssh. */
async function online() {
  const d = await workflowDaemon(cleanups, {}, [], { actions: true });
  const actions = d.actions;
  if (!actions) throw new Error("o daemon de teste não tem as ações");
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  const hostId = await act(() => store.addHost({ name: "alfa", url: d.server.url, token: TOKEN }));
  const prod = await store.addSecret({
    name: "chave-prod",
    type: "token",
    value: "x",
    tags: ["prod"],
    allowedHosts: [hostId],
  });
  const dev = await store.addSecret({
    name: "chave-dev",
    type: "token",
    value: "y",
    tags: ["dev"],
    allowedHosts: [hostId],
  });
  const save = (name: string, secret: { id: string }, extra: Record<string, unknown> = {}) =>
    actions.save({
      projectId: d.project.id,
      definition: {
        name,
        description: name,
        run: ["echo", "oi"],
        env: { TOKEN: `{{secret.${secret.id}}}` },
        ...extra,
      },
      secretIds: [secret.id],
    });
  await save("prod-local", prod);
  await save("prod-ssh", prod, { ssh: "prod-api" });
  await save("dev-local", dev);
  await settle(() => store.getState().hosts[0]?.status === "online");
  await sidebar.hostAction("Projetos", "alfa");
  await settle(() => screen.queryByRole("button", { name: "Ações de repo" }) !== null);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Ações de repo" }));
  });
  await settle(() => row("prod-local") !== null);
}

describe("acoes-ui-prod: the warning about a production secret on this host", () => {
  test("an action that runs here with a prod secret warns that a Claude session with Bash here can read it, and says to use ssh", async () => {
    await online();
    const text = (row("prod-local") as HTMLElement).textContent ?? "";
    expect(text).toContain("segredo de produção");
    expect(text).toContain("ação ssh");
  });

  test("an ssh action, or a secret that is not prod, carries no warning", async () => {
    await online();
    expect((row("prod-ssh") as HTMLElement).textContent).not.toContain("segredo de produção");
    expect((row("dev-local") as HTMLElement).textContent).not.toContain("segredo de produção");
  });
});
