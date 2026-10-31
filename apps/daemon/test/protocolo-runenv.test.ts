import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RunConfigs } from "../src/runenv/config.ts";
import { RunManager } from "../src/runenv/manager.ts";
import { CardPorts } from "../src/runenv/ports.ts";
import { startServer } from "../src/server.ts";
import { git, newBoard } from "./board-helpers.ts";
import { poll } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { fakeRunHost } from "./run-helpers.ts";

// Real git in a temp repository and a server: more than the default 5 s.
setDefaultTimeout(20_000);

const TOKEN = "runenv-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const YAML = `run:
  - name: web
    cmd: ["serve", "--port", "{{port.web}}"]
    ready: { http: "http://127.0.0.1:{{port.web}}/" }
ports: [web]
`;
const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

interface WireRun {
  cardId: string;
  status: string;
  ports: Record<string, number>;
  processes: Array<{ name: string; status: string; ready: string; url: string | null }>;
  error: string | null;
}

async function serve(options: { runenv?: boolean } = {}) {
  const ctx = newBoard();
  mkdirSync(join(ctx.repo, ".flightdeck"), { recursive: true });
  writeFileSync(join(ctx.repo, ".flightdeck", "run.yaml"), YAML);
  git(ctx.repo, "add", ".flightdeck");
  git(ctx.repo, "commit", "-q", "-m", "run.yaml");
  const project = await ctx.board.addProject({ path: ctx.repo });
  const fake = fakeRunHost();
  const configs = new RunConfigs({ db: ctx.store.db });
  const manager = new RunManager({
    db: ctx.store.db,
    configs,
    ports: new CardPorts({ db: ctx.store.db, isFree: async () => true }),
    host: fake.host,
    card: (id) => ({ id, projectId: project.id, worktreePath: `/work/${id}` }),
    project: (id) => ctx.board.getProject(id),
    waitReady: async () => "ready",
  });
  cleanups.push(() => ctx.board.stop());
  const server = startServer({
    manager: ctx.manager,
    board: ctx.board,
    ...(options.runenv === false ? {} : { runenv: { configs, manager } }),
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
  });
  cleanups.push(() => server.stop());
  const connect = async () => {
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    return client;
  };
  return { ...ctx, ...fake, project, server, connect };
}

describe("protocolo-runenv", () => {
  test("host.info anuncia a feature runenv só quando o daemon a tem", async () => {
    const withIt = await serve();
    const info = await (await withIt.connect()).data<{ features: string[] }>("host.info", {});
    expect(info?.features).toContain("runenv");
    const without = await serve({ runenv: false });
    const bare = await (await without.connect()).data<{ features: string[] }>("host.info", {});
    expect(bare?.features).not.toContain("runenv");
    const refused = await (await without.connect()).request("runenv.config", {
      projectId: without.project.id,
    });
    expect(refused).toMatchObject({ ok: false });
  });

  test("runenv.config mostra o arquivo e o hash; runenv.trust só aceita o hash revisado", async () => {
    const { connect, project } = await serve();
    const client = await connect();
    const before = await client.data<{
      exists: boolean;
      hash: string;
      trusted: boolean;
      errors: string[];
      config: { ports: string[] };
    }>("runenv.config", { projectId: project.id });
    expect(before).toMatchObject({ exists: true, hash: sha256(YAML), trusted: false, errors: [] });
    expect(before?.config.ports).toEqual(["web"]);
    expect(
      await client.request("runenv.trust", { projectId: project.id, hash: "velho" }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
    const after = await client.data<{ trusted: boolean }>("runenv.trust", {
      projectId: project.id,
      hash: sha256(YAML),
    });
    expect(after?.trusted).toBe(true);
    expect(await client.request("runenv.config", { projectId: "nenhum" })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  test("runenv.start recusa o run.yaml não confiado; confiado, sobe e runenv.get e runenv.stop acompanham", async () => {
    const { connect, project, of } = await serve();
    const client = await connect();
    expect(await client.request("runenv.start", { cardId: "card-a" })).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
    expect(of("serve")).toHaveLength(0);
    await client.request("runenv.trust", { projectId: project.id, hash: sha256(YAML) });
    const started = await client.data<WireRun>("runenv.start", { cardId: "card-a" });
    expect(started).toMatchObject({ cardId: "card-a", status: "running", ports: { web: 41000 } });
    expect(of("serve")[0]?.argv).toEqual(["serve", "--port", "41000"]);
    const got = await client.data<WireRun>("runenv.get", { cardId: "card-a" });
    expect(got?.processes.map((p) => [p.name, p.status, p.url])).toEqual([
      ["web", "running", "http://127.0.0.1:41000/"],
    ]);
    const stopped = await client.data<WireRun>("runenv.stop", { cardId: "card-a" });
    expect(stopped?.status).toBe("ended");
    expect(of("serve")[0]?.killed).toBe(true);
  });

  test("runenv.watch manda o estado dos Runs vivos e depois cada mudança, como runenv.updated", async () => {
    const { connect, project, finish } = await serve();
    const owner = await connect();
    await owner.request("runenv.trust", { projectId: project.id, hash: sha256(YAML) });
    await owner.data("runenv.start", { cardId: "card-a" });
    const watcher = await connect();
    expect((await watcher.request("runenv.watch", {})).ok).toBe(true);
    const frames = () =>
      watcher.frames.filter((f) => f.type === "runenv.updated").map((f) => f.state as WireRun);
    expect(
      await poll(() => frames().find((s) => s.cardId === "card-a" && s.status === "running")),
    ).toBeTruthy();
    finish("term-1", 0);
    expect(await poll(() => frames().find((s) => s.status === "ended"))).toBeTruthy();
    const count = frames().length;
    await owner.data("runenv.start", { cardId: "card-b" });
    expect(await poll(() => frames().length > count)).toBe(true);
  });
});
