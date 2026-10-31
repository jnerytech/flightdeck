import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../../daemon/src/config.ts";
import { git } from "../../daemon/test/board-helpers.ts";
import { poll } from "../../daemon/test/helpers.ts";
import { userLine, writeTranscript } from "../../daemon/test/history-helpers.ts";
import {
  DEFAULT_HUB_FILTER,
  HUB_FILTER_KEY,
  type HubRow,
  hubGroups,
  sharedMeta,
  loadHubFilter,
  saveHubFilter,
} from "../src/lib/hub.ts";
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

const clone = (root: string, name: string) => {
  const repo = join(root, name);
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "remote", "add", "origin", "https://github.com/acme/central.git");
  return repo;
};

/** Titles of a project group, top to bottom. */
const group = (name: string) =>
  [
    ...(screen.queryByRole("region", { name: `Projeto ${name}` })?.querySelectorAll("li") ?? []),
  ].map((li) => li.getAttribute("aria-label") ?? "");
const item = (title: string) => screen.queryByRole("listitem", { name: title });
/** The badge of a row: its first text with `label` (the summary line may repeat the word). */
const badge = (title: string, label: string) =>
  within(item(title) as HTMLElement).queryByRole("img", { name: label });

/** A row's menu, opened (Radix opens on pointer down). */
async function openMenu(title: string) {
  const trigger = screen.queryByRole("button", { name: `Ações de ${title}` });
  expect(trigger).not.toBeNull();
  await act(async () => {
    fireEvent.pointerDown(trigger as HTMLElement, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
  });
}
async function rowAction(title: string, action: string) {
  await openMenu(title);
  const entry = screen.queryByRole("menuitem", { name: action });
  expect(entry).not.toBeNull();
  await act(async () => {
    fireEvent.click(entry as HTMLElement);
  });
}

/**
 * One project (three clones of the same repository) with a Flightdeck session (idle), a terminal
 * session running, one waiting for Write (the app watches, so its hook is held) and a transcript.
 */
async function setup(platform = memoryPlatform()) {
  const d = makeDaemon(cleanups);
  const [one, two, three] = [
    clone(d.root, "gerenciada"),
    clone(d.root, "repo-run"),
    clone(d.root, "repo-ask"),
  ];
  const { sessionId } = d.manager.create({ cwd: one as string, prompt: "oi", name: "Gerenciada" });
  await poll(() => d.manager.get(sessionId).status === "idle");
  writeTranscript(d.historyRoot, "-old", "hist-1", [
    userLine({
      uuid: "h1",
      text: "Do histórico",
      cwd: three as string,
      ts: "2026-09-01T10:00:00.000Z",
    }),
  ]);
  d.history.scan();
  d.central.hooksInstall(true);
  const token = loadConfig(d.configFile).hooks.token ?? "";
  const hook = (session: string, event: string, cwd: string, body: Record<string, unknown> = {}) =>
    fetch(`${d.central.receptorUrl()}/hooks/${event}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ session_id: session, hook_event_name: event, cwd, ...body }),
    })
      .then((r) => r.text())
      .catch(() => "");
  const copied: string[] = [];
  platform.platform.copyText = async (text) => {
    copied.push(text);
  };
  const store = new AppStore(platform.platform, {
    baseDelayMs: 60_000,
    timeZone: "America/Sao_Paulo",
  });
  render(<App store={store} />);
  await act(async () => {
    await store.addHost({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  // The waiting one first, so the running one is the newest.
  await hook("ext-ask", "SessionStart", three as string);
  await hook("ext-ask", "UserPromptSubmit", three as string, { prompt: "grave o arquivo" });
  void hook("ext-ask", "PermissionRequest", three as string, {
    tool_name: "Write",
    tool_input: { file_path: "a.txt", content: "x" },
  });
  await settle(() => Object.keys(store.getState().externalRequests).length === 1);
  await hook("ext-run", "SessionStart", two as string);
  await hook("ext-run", "UserPromptSubmit", two as string, { prompt: "rode" });
  await act(async () => store.router.push({ name: "hub" }));
  await settle(() => group("central").length === 4);
  // The hooks' states land after the rows: wait for them too, or the checks race the app.
  await settle(
    () =>
      !!badge("repo-ask", "precisa de você") &&
      !!badge("repo-run", "rodando") &&
      !!badge("Gerenciada", "ociosa"),
  );
  return { d, store, copied, platform, sessionId };
}

const hubRow = (patch: Partial<HubRow>): HubRow => ({
  key: "k",
  hostId: "h",
  hostName: "alfa",
  origin: "flightdeck",
  claudeSessionId: "c",
  sessionId: "s",
  title: "t",
  cwd: "/x",
  projectKey: "p",
  state: "idle",
  controllable: false,
  lastActivity: "2026-10-29T10:00:00.000Z",
  pinned: false,
  archived: false,
  summary: null,
  persona: null,
  ...patch,
});

describe("hub-ui: o que se repete vai para o cabeçalho do grupo", () => {
  test("a host shared by every row of a group is said once, in its header; each row keeps only what differs", async () => {
    await setup();
    const region = screen.getByRole("region", { name: "Projeto central" });
    const header = region.querySelector("[data-slot='group-meta']");
    expect(header?.textContent).toBe("alfa");
    for (const title of ["repo-run", "repo-ask", "Gerenciada"]) {
      const meta = (item(title) as HTMLElement).querySelector("[data-slot='row-meta']");
      expect(meta?.textContent ?? "").not.toContain("alfa");
    }
    expect(
      (item("repo-run") as HTMLElement).querySelector("[data-slot='row-meta']")?.textContent,
    ).toBe("terminal");
    expect(
      (item("Gerenciada") as HTMLElement).querySelector("[data-slot='row-meta']")?.textContent,
    ).toBe("Flightdeck");
  });

  test("a group whose rows all come from the same host and origin has no per-row meta at all", () => {
    expect(sharedMeta([hubRow({}), hubRow({ key: "k2" })])).toEqual({
      hostName: "alfa",
      origin: "flightdeck",
    });
    expect(
      sharedMeta([hubRow({}), hubRow({ key: "k2", hostName: "beta", origin: "terminal" })]),
    ).toEqual({ hostName: null, origin: null });
  });
});

describe("hub-ui", () => {
  test("precisa de você sobe ao topo do grupo, acima das fixadas; depois fixadas e a última atividade", () => {
    const rows = [
      hubRow({ title: "velha", lastActivity: "2026-10-29T08:00:00.000Z" }),
      hubRow({ title: "nova", lastActivity: "2026-10-29T12:00:00.000Z" }),
      hubRow({ title: "fixada", pinned: true, lastActivity: "2026-10-29T07:00:00.000Z" }),
      hubRow({ title: "pedindo", state: "needs_you", lastActivity: "2026-10-29T06:00:00.000Z" }),
    ];
    const [only] = hubGroups(rows, DEFAULT_HUB_FILTER);
    expect(only?.rows.map((r) => r.title)).toEqual(["pedindo", "fixada", "nova", "velha"]);
  });

  test("os filtros são guardados no app, menos o texto digitado, e voltam a cada abertura", () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
    };
    expect(loadHubFilter(storage)).toEqual(DEFAULT_HUB_FILTER);
    saveHubFilter(storage, {
      text: "algo",
      host: "alfa",
      origin: "terminal",
      state: "idle",
      persona: "qa",
      pinnedOnly: true,
      showArchived: true,
    });
    expect(JSON.parse(items.get(HUB_FILTER_KEY) ?? "{}")).toEqual({
      host: "alfa",
      origin: "terminal",
      state: "idle",
      persona: "qa",
      pinnedOnly: true,
      showArchived: true,
    });
    expect(loadHubFilter(storage)).toEqual({
      text: "",
      host: "alfa",
      origin: "terminal",
      state: "idle",
      persona: "qa",
      pinnedOnly: true,
      showArchived: true,
    });
    // Anything unreadable falls back to the defaults, field by field.
    items.set(HUB_FILTER_KEY, JSON.stringify({ host: 3, origin: "nada", state: "idle" }));
    expect(loadHubFilter(storage)).toEqual({ ...DEFAULT_HUB_FILTER, state: "idle" });
    items.set(HUB_FILTER_KEY, "não é json");
    expect(loadHubFilter(storage)).toEqual(DEFAULT_HUB_FILTER);
  });

  test("a linha: título, pontinho de estado e host; origem e hora local na segunda linha; precisa de você ganha fundo e ícone", async () => {
    await setup();
    expect(group("central")).toEqual(["repo-ask", "repo-run", "Gerenciada", "Do histórico"]);
    const ask = item("repo-ask") as HTMLElement;
    // Needs you is an amber dot in a 32 px line, nothing more.
    expect(ask.className).toContain("h-8");
    expect(ask.className).not.toContain("bg-status-needs-you");
    expect(ask.querySelector("svg[data-icon='needs-you']")).toBeNull();
    expect(badge("repo-ask", "precisa de você")?.className).toContain("bg-status-needs-you");
    expect(within(ask).queryByText(/^alfa/)).not.toBeNull();
    expect(badge("repo-run", "rodando")?.className).toContain("bg-status-running");
    expect(badge("Gerenciada", "ociosa")?.className).toContain("bg-status-idle");
    // Local time of the instant, not UTC: 10:00 UTC is 07:00 in São Paulo.
    expect(item("Do histórico")?.textContent ?? "").toContain("alfa · histórico");
    expect(item("Do histórico")?.querySelector("time")?.getAttribute("title")).toBe(
      "01/09/2026, 07:00",
    );
    expect(item("Do histórico")?.querySelector("time")?.textContent).toBe("1 de set.");
    expect(item("Do histórico")?.textContent ?? "").not.toContain("10:00");
    expect(badge("Do histórico", "encerrada")?.className).toContain("bg-status-ended");
  });

  test("as ações ficam num menu no fim da linha, sem ícones soltos: renomear, fixar, arquivar e copiar o comando", async () => {
    const { copied, d, sessionId } = await setup();
    for (const loose of [
      "Renomear repo-run",
      "Fixar repo-run",
      "Arquivar repo-run",
      "Copiar comando de repo-run",
    ]) {
      expect(screen.queryByRole("button", { name: loose })).toBeNull();
    }
    await openMenu("repo-run");
    expect(screen.queryAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Abrir em nova aba",
      "Renomear",
      "Fixar",
      "Arquivar",
      "Copiar comando",
    ]);
    await act(async () => {
      fireEvent.keyDown(screen.queryAllByRole("menuitem")[0] as HTMLElement, { key: "Escape" });
    });

    await rowAction("Gerenciada", "Fixar");
    await settle(() => group("central")[1] === "Gerenciada");
    // The waiting one stays above the pinned.
    expect(group("central")).toEqual(["repo-ask", "Gerenciada", "repo-run", "Do histórico"]);
    await openMenu("Gerenciada");
    expect(screen.queryByRole("menuitem", { name: "Desafixar" })).not.toBeNull();
    await act(async () => {
      fireEvent.keyDown(screen.queryAllByRole("menuitem")[0] as HTMLElement, { key: "Escape" });
    });

    await rowAction("Do histórico", "Arquivar");
    await settle(() => !group("central").includes("Do histórico"));
    expect(group("central")).not.toContain("Do histórico");

    await rowAction("repo-run", "Renomear");
    const field = screen.queryByLabelText("Novo nome") as HTMLInputElement | null;
    expect(field).not.toBeNull();
    await act(async () => {
      fireEvent.change(field as HTMLInputElement, { target: { value: "Servidor" } });
    });
    await act(async () => {
      fireEvent.click(screen.queryByRole("button", { name: "Salvar nome" }) as HTMLElement);
    });
    await settle(() => group("central").includes("Servidor"));
    expect(group("central")).toContain("Servidor");

    await rowAction("Servidor", "Copiar comando");
    expect(copied).toEqual(["flightdeckd claude --resume ext-run"]);
    expect(d.manager.get(sessionId).status).toBe("idle");
  });

  test("os filtros escolhidos ficam guardados e voltam na próxima abertura do app", async () => {
    const first = await setup();
    const select = (label: string) => screen.queryByLabelText(label) as HTMLSelectElement | null;
    await sidebar.openFilters();
    await act(async () => {
      fireEvent.change(select("Estado") as HTMLSelectElement, { target: { value: "idle" } });
      fireEvent.change(select("Host") as HTMLSelectElement, { target: { value: "alfa" } });
    });
    await act(async () => {
      fireEvent.change(screen.queryByLabelText("Filtrar sessões") as HTMLInputElement, {
        target: { value: "gerenc" },
      });
    });
    expect(group("central")).toEqual(["Gerenciada"]);
    expect(JSON.parse(first.platform.items.get(HUB_FILTER_KEY) ?? "{}")).toMatchObject({
      state: "idle",
      host: "alfa",
    });

    // The next opening of the app: same storage, a new store; the typed text is not kept.
    cleanup();
    const store = new AppStore(first.platform.platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    await act(async () => store.router.push({ name: "hub" }));
    await settle(() => screen.queryByLabelText("Filtrar sessões") !== null);
    // The button counts the two filters kept; the popover shows them.
    expect(screen.queryByRole("button", { name: /^Filtros/ })?.textContent).toBe("Filtros2");
    await sidebar.openFilters();
    expect(select("Estado")?.value).toBe("idle");
    expect(select("Host")?.value).toBe("alfa");
    expect((screen.queryByLabelText("Filtrar sessões") as HTMLInputElement | null)?.value).toBe("");
  });

  test("uma hora ilegível (ou vazia) não vira texto estranho na linha", () => {
    const store = new AppStore(memoryPlatform().platform, { timeZone: "America/Sao_Paulo" });
    expect(() => store.formatDateTime("")).not.toThrow();
    expect(() => store.formatDateTime("ontem")).not.toThrow();
    expect(store.formatDateTime("")).toBe("");
    expect(store.formatDateTime("ontem")).toBe("");
    expect(store.formatDateTime("2026-09-01T10:00:00.000Z")).toBe("01/09/2026, 07:00");
  });
});
