import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { git, gitRepo } from "../../daemon/test/board-helpers.ts";
import { AppStore, sessionKey } from "../src/lib/app-store.ts";
import { WORKSPACE_KEY } from "../src/lib/workspace.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { App } = await import("../src/ui/App.tsx");

// Real git, a daemon and a fake runtime: more than the default 5 s.
setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const YAML = `setup: ["prepare"]
run:
  - name: web
    cmd: ["serve", "--port", "{{port.web}}"]
    ready: { http: "http://127.0.0.1:{{port.web}}/" }
ports: [web]
`;
const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

/** Waits briefly for a condition and answers whether it held: the `expect` after it decides. */
async function until(check: () => unknown, ms = 1500): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await Bun.sleep(10);
  }
  return Boolean(check());
}

/** A host with a project whose run.yaml is committed, and a card with its worktree. */
async function setup() {
  const d = makeDaemon(cleanups, { runenv: true });
  const { repo } = gitRepo("run-app");
  // The repo must be inside the daemon's allowed root.
  const inside = join(d.root, "run-app");
  git(d.root, "clone", "-q", repo, inside);
  git(inside, "config", "commit.gpgsign", "false");
  mkdirSync(join(inside, ".flightdeck"), { recursive: true });
  writeFileSync(join(inside, ".flightdeck", "run.yaml"), YAML);
  git(inside, "add", ".flightdeck");
  git(inside, "commit", "-q", "-m", "run.yaml");
  const store = new AppStore(memoryPlatform(false, "pt-BR").platform, {
    baseDelayMs: 10,
    maxDelayMs: 20,
  });
  cleanups.push(() => store.dispose());
  const hostId = await store.addHost({ name: "pc", url: d.listen().url, token: TOKEN });
  await waitFor(() => store.getState().hosts.find((h) => h.id === hostId)?.status === "online");
  const project = await store.hostCommand(hostId, "project.add", { path: inside });
  const created = await store.hostCommand(hostId, "card.create", {
    projectId: project?.id ?? "",
    title: "Rodar",
    description: "faça",
  });
  const cardId = created?.id ?? "";
  await store.hostCommand(hostId, "card.start", { cardId });
  await waitFor(() => d.board.getCard(cardId).worktreePath);
  return {
    ...d,
    store,
    hostId,
    projectId: project?.id ?? "",
    cardId,
    key: sessionKey(hostId, cardId),
  };
}

describe("run-ui: o estado do Run na loja", () => {
  test("o run.yaml do projeto vem com o hash, e só se confia no hash revisado", async () => {
    const { store, hostId, projectId } = await setup();
    const info = await store.runEnvConfig(hostId, projectId);
    expect(info).toMatchObject({ exists: true, hash: sha256(YAML), trusted: false, errors: [] });
    expect(info?.config?.ports).toEqual(["web"]);
    const trusted = await store.runTrust(hostId, projectId, sha256(YAML));
    expect(trusted?.trusted).toBe(true);
  });

  test("Run sobe o setup e os processos, e a loja guarda o estado de cada mudança até o Stop", async () => {
    const { store, hostId, projectId, cardId, key, runHost } = await setup();
    await store.runTrust(hostId, projectId, sha256(YAML));
    expect(store.getState().runEnvs[key]).toBeUndefined();
    await store.runStart(hostId, cardId);
    expect(await until(() => store.getState().runEnvs[key]?.status === "setup")).toBe(true);
    runHost?.finish("term-1", 0);
    expect(await until(() => store.getState().runEnvs[key]?.status === "running")).toBe(true);
    expect(store.getState().runEnvs[key]?.ports).toEqual({ web: 41000 });
    expect(store.getState().runEnvs[key]?.processes.map((p) => [p.name, p.url])).toEqual([
      ["web", "http://127.0.0.1:41000/"],
    ]);
    expect(await until(() => store.getState().runEnvs[key]?.processes[0]?.ready === "ready")).toBe(
      true,
    );
    await store.runStop(hostId, cardId);
    expect(await until(() => store.getState().runEnvs[key]?.status === "ended")).toBe(true);
    expect(runHost?.spawned.at(-1)?.killed).toBe(true);
  });

  test("um Run recusado (run.yaml não confiado) vai para o aviso e não deixa estado", async () => {
    const { store, hostId, cardId, key } = await setup();
    await store.runStart(hostId, cardId);
    expect(store.getState().runEnvs[key]).toBeUndefined();
    expect(store.getState().error ?? "").toContain("não confiado");
  });
});

describe("run-ui: o preview em uma aba", () => {
  function shown() {
    const mem = memoryPlatform(false, "pt-BR");
    const opened: string[] = [];
    mem.win.open = (url) => {
      opened.push(String(url));
      return null;
    };
    const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
    render(<App store={store} />);
    return { store, opened, items: mem.items };
  }
  const frame = () => document.querySelector("iframe");

  test("a rota preview mostra o app do card num quadro e o botão abre o mesmo endereço no navegador", async () => {
    const { store, opened } = shown();
    await act(async () => {
      store.tabs.open({ name: "preview", url: "http://127.0.0.1:41000/", title: "web" });
    });
    expect(frame()?.getAttribute("src")).toBe("http://127.0.0.1:41000/");
    expect(frame()?.getAttribute("title")).toBe("Preview de web");
    const button = screen.queryByRole("button", { name: "Abrir no navegador" });
    expect(button).not.toBeNull();
    await act(async () => {
      if (button) fireEvent.click(button);
    });
    expect(opened).toEqual(["http://127.0.0.1:41000/"]);
    expect(screen.queryAllByRole("tab").map((tab) => tab.textContent)).toContain("web");
  });

  test("um endereço fora do loopback não abre quadro nem botão: a tela recusa", async () => {
    const { store, opened } = shown();
    await act(async () => {
      store.tabs.open({ name: "preview", url: "http://example.com/", title: "fora" });
    });
    expect(frame()).toBeNull();
    expect(screen.queryByRole("button", { name: "Abrir no navegador" })).toBeNull();
    expect(screen.queryByText("Só endereços de 127.0.0.1 e localhost abrem aqui.")).not.toBeNull();
    expect(opened).toEqual([]);
  });

  test("a aba de preview não volta ao reabrir o app: o endereço pode ser de outro programa agora", async () => {
    const { store, items } = shown();
    await act(async () => {
      store.tabs.open({ name: "preview", url: "http://127.0.0.1:41000/", title: "web" });
    });
    const kept = JSON.parse(items.get(WORKSPACE_KEY) ?? "null");
    expect(JSON.stringify(kept)).not.toContain("41000");
    const next = new AppStore(memoryPlatform(false, "pt-BR").platform);
    expect(next.workspace.tabs.router.current.name).toBe("home");
  });

  test("a CSP do app deixa quadros só em http(s) 127.0.0.1 e localhost", () => {
    const conf = JSON.parse(
      readFileSync(resolve(import.meta.dir, "../src-tauri/tauri.conf.json"), "utf8"),
    ) as { app: { security: { csp: string } } };
    const csp = conf.app.security.csp;
    const directive = csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("frame-src"));
    expect(directive).toBe(
      "frame-src http://127.0.0.1:* http://localhost:* https://127.0.0.1:* https://localhost:*",
    );
    expect(csp).toContain("default-src 'self'");
  });
});
