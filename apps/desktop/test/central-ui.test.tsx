import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../daemon/src/config.ts";
import { git } from "../../daemon/test/board-helpers.ts";
import { connectChannel } from "../../daemon/test/channel-helpers.ts";
import { poll } from "../../daemon/test/helpers.ts";
import { userLine, writeTranscript } from "../../daemon/test/history-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { sidebarNav } from "./sidebar.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const sidebar = sidebarNav({ act, fireEvent, screen });
const { AppStore } = await import("../src/lib/app-store.ts");
const { App } = await import("../src/ui/App.tsx");

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

const click = async (name: string) => {
  // The hub's toggles live in the Filtros popover.
  if (name === "Só fixadas" || name === "Mostrar arquivadas") await sidebar.openFilters();
  const button = screen.queryByRole("button", { name });
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};

const change = async (label: string, value: string) => {
  if (["Host", "Origem", "Estado"].includes(label)) await sidebar.openFilters();
  const field = screen.queryByLabelText(label) as HTMLInputElement | null;
  expect(field).not.toBeNull();
  await act(async () => {
    fireEvent.change(field as HTMLInputElement, { target: { value } });
  });
};

/** A row's action from its menu (phase 10: no loose icons); Radix opens on pointer down. */
const rowAction = async (title: string, action: string) => {
  const trigger = screen.queryByRole("button", { name: `Ações de ${title}` });
  expect(trigger).not.toBeNull();
  await act(async () => {
    fireEvent.pointerDown(trigger as HTMLElement, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
  });
  const entry = screen.queryByRole("menuitem", { name: action });
  expect(entry).not.toBeNull();
  await act(async () => {
    fireEvent.click(entry as HTMLElement);
  });
};

/** Titles in a project group, top to bottom. */
const group = (name: string) =>
  [
    ...(screen.queryByRole("region", { name: `Projeto ${name}` })?.querySelectorAll("li") ?? []),
  ].map((li) => li.getAttribute("aria-label") ?? "");
const row = (title: string) => {
  const li = screen.queryByRole("listitem", { name: title });
  // The state is a dot: its label is part of what the row says.
  const states = [...(li?.querySelectorAll("[role='img']") ?? [])].map((i) =>
    i.getAttribute("aria-label"),
  );
  return `${li?.textContent ?? ""} ${states.join(" ")}`;
};

/** A clone of the same GitHub repository inside a daemon's allowed root. */
function clone(root: string) {
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "remote", "add", "origin", "https://github.com/acme/central.git");
  return repo;
}

/**
 * Two hosts of the same project: alfa with a Flightdeck session and a terminal session (hooks
 * installed, so its receptor holds permission requests), beta with an older history session.
 */
async function setup() {
  const alfa = makeDaemon(cleanups);
  const beta = makeDaemon(cleanups);
  const repoA = clone(alfa.root);
  const repoB = clone(beta.root);
  const { sessionId } = alfa.manager.create({ cwd: repoA, prompt: "oi", name: "Gerenciada" });
  // Idle before the terminal session acts, so its last activity is older (fixed order).
  await poll(() => alfa.manager.get(sessionId).status === "idle");
  alfa.central.hooksInstall(true);
  const hooksToken = loadConfig(alfa.configFile).hooks.token ?? "";
  const receptor = alfa.central.receptorUrl() ?? "";
  const hook = (event: string, body: Record<string, unknown>) =>
    fetch(`${receptor}/hooks/${event}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${hooksToken}` },
      body: JSON.stringify({ session_id: "ext-1", hook_event_name: event, ...body }),
    }).then((r) => r.text());
  await hook("SessionStart", { cwd: repoA, launch_id: "L1", source: "startup" });
  await hook("UserPromptSubmit", { prompt: "rode os testes" });
  // Its transcript is in alfa's history too: the list shows it once, as the live session.
  writeTranscript(alfa.historyRoot, "-repo", "ext-1", [
    userLine({ uuid: "x1", text: "rode os testes", cwd: repoA, ts: new Date().toISOString() }),
  ]);
  alfa.history.scan();
  const old = writeTranscript(beta.historyRoot, "-repo", "hist-1", [
    userLine({ uuid: "u1", text: "Do histórico", cwd: repoB, ts: "2026-09-01T10:00:00.000Z" }),
  ]);
  utimesSync(old, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
  beta.history.scan();

  const mem = memoryPlatform();
  const copied: string[] = [];
  mem.platform.copyText = async (text) => {
    copied.push(text);
  };
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: alfa.listen().url, token: TOKEN });
    await store.addHost({ name: "beta", url: beta.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts.every((h) => h.status === "online"));
  await click("Abrir Sessões");
  await settle(() => group("central").length === 3);
  return { alfa, store, hook, receptor, hooksToken, copied, notifications: mem.notifications };
}

describe("central-ui", () => {
  test("junta gerenciada, externa e do histórico de dois hosts no mesmo grupo de projeto", async () => {
    await setup();
    expect(group("central")).toEqual(["repo", "Gerenciada", "Do histórico"]);
    expect(row("repo")).toContain("alfa");
    expect(row("repo")).toContain("terminal");
    expect(row("repo")).toContain("rodando");
    expect(row("Gerenciada")).toContain("Flightdeck");
    expect(row("Do histórico")).toContain("beta");
    expect(row("Do histórico")).toContain("histórico");
    expect(row("Do histórico")).toContain("encerrada");
  });

  test("filtros por texto, host, origem e estado", async () => {
    await setup();
    await change("Filtrar sessões", "gerenc");
    expect(group("central")).toEqual(["Gerenciada"]);
    await change("Filtrar sessões", "");
    await change("Host", "beta");
    expect(group("central")).toEqual(["Do histórico"]);
    await change("Host", "");
    await change("Origem", "terminal");
    expect(group("central")).toEqual(["repo"]);
    await change("Origem", "");
    await change("Estado", "ended");
    expect(group("central")).toEqual(["Do histórico"]);
  });

  test("fixadas no topo do grupo; arquivadas escondidas por padrão; renomear e copiar o comando", async () => {
    const { copied } = await setup();
    await rowAction("Do histórico", "Fixar");
    await settle(() => group("central")[0] === "Do histórico");
    expect(group("central")).toEqual(["Do histórico", "repo", "Gerenciada"]);
    await click("Só fixadas");
    expect(group("central")).toEqual(["Do histórico"]);
    await click("Só fixadas");
    await rowAction("Gerenciada", "Arquivar");
    await settle(() => !group("central").includes("Gerenciada"));
    expect(group("central")).toEqual(["Do histórico", "repo"]);
    await click("Mostrar arquivadas");
    expect(group("central")).toContain("Gerenciada");
    await rowAction("Gerenciada", "Desarquivar");
    await rowAction("Do histórico", "Desafixar");
    await rowAction("repo", "Renomear");
    await change("Novo nome", "Terminal X");
    await click("Salvar nome");
    await settle(() => group("central").includes("Terminal X"));
    expect(group("central")).toContain("Terminal X");
    await rowAction("Terminal X", "Copiar comando");
    expect(copied).toEqual(["flightdeckd claude --resume ext-1"]);
  });

  test("pedido externo aparece em Precisa de você, notifica e é respondido", async () => {
    const { hook, notifications } = await setup();
    const answer = hook("PermissionRequest", {
      tool_name: "Write",
      tool_input: { file_path: "a" },
    });
    await sidebar.openQueue();
    await settle(() => screen.queryByRole("button", { name: "alfa · repo: Write" }) !== null);
    expect(notifications.map((n) => n.title)).toContain("Precisa de você");
    // The queue shows the request and its card answers it.
    await sidebar.queueItem("alfa · repo: Write");
    await click("Aprovar");
    expect(JSON.parse(await answer)).toEqual({
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    });
  });

  test("sessão externa viva: leitor ao vivo, pedidos inline e caixa de mensagem só se controlável", async () => {
    const { hook, receptor, hooksToken } = await setup();
    await click("repo");
    await settle(() => screen.queryByRole("heading", { name: "repo" }) !== null);
    expect(screen.queryByLabelText("Mensagem para a sessão")).toBeNull();
    const answer = hook("PermissionRequest", { tool_name: "Bash", tool_input: { command: "ls" } });
    await settle(() => screen.queryByRole("group", { name: "Pedido de Bash" }) !== null);
    // Negar, then (the reason is optional) Negar again sends it.
    await click("Negar");
    await click("Negar");
    expect(JSON.parse(await answer).hookSpecificOutput.decision.behavior).toBe("deny");
    const channel = await connectChannel(receptor, hooksToken, "L1");
    cleanups.push(channel.close);
    await settle(() => screen.queryByLabelText("Mensagem para a sessão") !== null);
    await change("Mensagem para a sessão", "rode o build");
    await click("Enviar mensagem");
    expect(await poll(() => channel.received[0])).toBe("rode o build");
    const approve = hook("PermissionRequest", { tool_name: "Edit", tool_input: {} });
    await settle(() => screen.queryByRole("group", { name: "Pedido de Edit" }) !== null);
    await click("Aprovar");
    expect(JSON.parse(await approve).hookSpecificOutput.decision.behavior).toBe("allow");
  });

  test("abrir a gerenciada mostra a conversa; a do histórico, o leitor; o pedido abre a sessão externa", async () => {
    const { hook } = await setup();
    await click("Gerenciada");
    await settle(() => screen.queryByLabelText("Mensagem") !== null);
    expect(screen.queryByLabelText("Mensagem")).not.toBeNull();
    await click("Abrir Sessões");
    await settle(() => group("central").length === 3);
    await click("Do histórico");
    await settle(() => screen.queryByRole("log", { name: "Transcript" }) !== null);
    expect(screen.queryByRole("log", { name: "Transcript" })).not.toBeNull();
    void hook("PermissionRequest", { tool_name: "Read", tool_input: {} });
    await sidebar.openQueue();
    await settle(() => screen.queryByRole("button", { name: "alfa · repo: Read" }) !== null);
    await sidebar.queueItem("alfa · repo: Read");
    await click("Abrir sessão");
    await settle(() => screen.queryByRole("heading", { name: "repo" }) !== null);
    expect(screen.queryByRole("button", { name: "Aprovar" })).not.toBeNull();
    await click("Aprovar");
  });
});
