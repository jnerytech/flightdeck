import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, gitRepo } from "../../daemon/test/board-helpers.ts";
import { AppStore, sessionKey } from "../src/lib/app-store.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN, waitFor } from "./fixtures.ts";

// Real git, a daemon and a fake runtime: more than the default 5 s.
setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
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
    expect(store.getState().runEnvs[key]?.processes.map((p) => [p.name, p.url, p.ready])).toEqual([
      ["web", "http://127.0.0.1:41000/", "waiting"],
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
