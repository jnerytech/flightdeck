import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../daemon/src/config.ts";
import { git } from "../../daemon/test/board-helpers.ts";
import { poll, record } from "../../daemon/test/helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

// Real git under the in-process daemon: more than the default 5 s.
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

async function online() {
  const d = makeDaemon(cleanups);
  const server = d.listen();
  const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  return { ...d, store, hostId };
}

/** A managed session asking for a permission, open in the app. */
async function asking(prompt: string) {
  const ctx = await online();
  const { sessionId } = ctx.manager.create({ cwd: ctx.project, prompt });
  const events = record(ctx.manager, sessionId);
  cleanups.push(() => events.unsubscribe());
  await poll(() => events.find("permission.requested")[0], 3000);
  await act(async () => ctx.store.select(ctx.hostId, sessionId));
  await settle(() => screen.queryByRole("button", { name: "Permitir" }) !== null);
  const result = () => poll(() => events.find("tool.result")[0]?.content, 3000);
  return { ...ctx, sessionId, result };
}

describe("permitir-ui", () => {
  test("Permitir nesta sessão manda as sugestões de sessão do pedido", async () => {
    const { result, project } = await asking("[tool] x");
    await click("Permitir nesta sessão");
    const content = (await result()) ?? "";
    expect(content).toStartWith("arquivo criado: fake.txt; permissões:");
    expect(JSON.parse(content.split("permissões: ")[1] ?? "[]")).toEqual([
      { type: "addDirectories", directories: [project], destination: "session" },
      { type: "setMode", mode: "acceptEdits", destination: "session" },
    ]);
  });

  test("Sempre neste projeto abre a regra: no Bash, o comando exato, que pode virar prefixo", async () => {
    const { result } = await asking("[bash] y");
    await click("Sempre neste projeto");
    expect((screen.queryByLabelText("Regra") as HTMLInputElement | null)?.value).toBe(
      "Bash(npm test --silent)",
    );
    await change("Regra", "Bash(npm test:*)");
    await click("Salvar regra");
    expect(JSON.parse((await result())?.split("permissões: ")[1] ?? "[]")).toEqual([
      {
        type: "addRules",
        rules: [{ toolName: "Bash", ruleContent: "npm test:*" }],
        behavior: "allow",
        destination: "localSettings",
      },
    ]);
  });

  test("nas outras ferramentas a regra padrão é o nome da ferramenta; Cancelar fecha a edição", async () => {
    const { result } = await asking("[tool] z");
    await click("Sempre neste projeto");
    expect((screen.queryByLabelText("Regra") as HTMLInputElement | null)?.value).toBe("Write");
    await click("Cancelar");
    expect(screen.queryByLabelText("Regra")).toBeNull();
    await click("Sempre neste projeto");
    await click("Salvar regra");
    expect((await result()) ?? "").toContain('"rules":[{"toolName":"Write"}]');
  });

  test("regra recusada pelo daemon mostra o erro e o pedido segue aberto", async () => {
    const { store, sessionId, manager } = await asking("[bash] y");
    await click("Sempre neste projeto");
    await change("Regra", "Read(x)");
    await click("Salvar regra");
    await settle(() => store.getState().error !== null);
    expect(store.getState().error ?? "").toContain("invalid_permission_update");
    expect(screen.queryByRole("button", { name: "Permitir" })).not.toBeNull();
    expect(manager.get(sessionId).status).toBe("awaiting_permission");
  });

  test("pedido do terminal: Permitir nesta sessão só aparece com sugestão de sessão", async () => {
    const d = await online();
    d.central.hooksInstall(true);
    const hooksToken = loadConfig(d.configFile).hooks.token ?? "";
    const hook = (event: string, body: Record<string, unknown>) =>
      fetch(`${d.central.receptorUrl()}/hooks/${event}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${hooksToken}` },
        body: JSON.stringify({ session_id: "ext-7", hook_event_name: event, ...body }),
      })
        .then((r) => r.text())
        // A hook still held when the test ends has its connection dropped by the cleanup.
        .catch(() => "{}");
    await hook("SessionStart", { cwd: d.project, source: "startup" });
    const plain = hook("PermissionRequest", {
      tool_name: "Read",
      tool_input: {},
      permission_suggestions: [],
    });
    await settle(() => screen.queryByRole("button", { name: "alfa · p: Read" }) !== null);
    await click("alfa · p: Read");
    await settle(() => screen.queryByRole("button", { name: "Aprovar Read" }) !== null);
    expect(screen.queryByRole("button", { name: "Permitir nesta sessão" })).toBeNull();
    await click("Aprovar Read");
    expect(JSON.parse(await plain).hookSpecificOutput.decision).toEqual({ behavior: "allow" });
    const suggestion = { type: "addDirectories", directories: ["novo"], destination: "session" };
    const withSuggestion = hook("PermissionRequest", {
      tool_name: "Bash",
      tool_input: { command: "mkdir novo" },
      permission_suggestions: [suggestion],
    });
    await settle(() => screen.queryByRole("button", { name: "Permitir nesta sessão" }) !== null);
    await click("Permitir nesta sessão");
    expect(JSON.parse(await withSuggestion).hookSpecificOutput.decision).toEqual({
      behavior: "allow",
      updatedPermissions: [suggestion],
    });
  });

  test("seção Regras do projeto lista e remove com confirmação", async () => {
    const { board, root } = await online();
    const repo = join(root, "repo");
    mkdirSync(join(repo, ".claude"), { recursive: true });
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "commit.gpgsign", "false");
    writeFileSync(join(repo, "README.md"), "# repo\n");
    git(repo, "add", "README.md");
    git(repo, "commit", "-q", "-m", "inicial");
    const settings = join(repo, ".claude", "settings.local.json");
    writeFileSync(
      settings,
      JSON.stringify({ permissions: { allow: ["Read", "Bash(npm test:*)"] }, outra: 1 }),
    );
    await board.addProject({ path: repo, promptTemplate: "" });
    await click("Projetos de alfa");
    await settle(() => screen.queryByRole("button", { name: "Editar repo" }) !== null);
    await click("Editar repo");
    const rules = () =>
      [...(screen.queryByRole("region", { name: "Regras" })?.querySelectorAll("li") ?? [])].map(
        (li) => li.querySelector("code")?.textContent ?? "",
      );
    await settle(() => rules().length === 2);
    expect(rules()).toEqual(["Read", "Bash(npm test:*)"]);
    await click("Remover Read");
    expect(screen.queryByRole("dialog")?.textContent ?? "").toContain("Read");
    await click("Cancelar");
    expect(rules()).toHaveLength(2);
    await click("Remover Read");
    await click("Confirmar");
    await settle(() => rules().length === 1);
    expect(rules()).toEqual(["Bash(npm test:*)"]);
    expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual({
      permissions: { allow: ["Bash(npm test:*)"] },
      outra: 1,
    });
  });

  test("host sem rules: nem os botões de permitir sempre nem a seção Regras, e sem banner de erro", async () => {
    const d = makeDaemon(cleanups);
    const repo = join(d.root, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "commit.gpgsign", "false");
    writeFileSync(join(repo, "README.md"), "# repo\n");
    git(repo, "add", "README.md");
    git(repo, "commit", "-q", "-m", "inicial");
    await d.board.addProject({ path: repo, promptTemplate: "" });
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => {
      await store.addHost({
        name: "alfa",
        url: d.listen(0, undefined, ["central", "workflows"]).url,
        token: TOKEN,
      });
    });
    await settle(
      () =>
        store.getState().hosts[0]?.hostInfo !== null &&
        store.getState().hosts[0]?.hostInfo !== undefined,
    );
    const hostId = store.getState().hosts[0]?.id ?? "";
    const { sessionId } = d.manager.create({ cwd: d.project, prompt: "[bash] y" });
    await poll(() => d.eventStore.pendingPermissions(sessionId).length > 0, 3000);
    await act(async () => store.select(hostId, sessionId));
    await settle(() => screen.queryByRole("button", { name: "Permitir" }) !== null);
    expect(screen.queryByRole("button", { name: "Permitir" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Sempre neste projeto" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Permitir nesta sessão" })).toBeNull();
    await click("Projetos de alfa");
    await settle(() => screen.queryByRole("button", { name: "Editar repo" }) !== null);
    await click("Editar repo");
    await act(() => Bun.sleep(100));
    expect(screen.queryByRole("region", { name: "Regras" })).toBeNull();
    expect(store.getState().error).toBeNull();
  });
});
