import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { startDaemon } from "../src/main.ts";
import { git, gitRepo } from "./board-helpers.ts";
import { must, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { fakePtys } from "./pty-helpers.ts";

// Real git, a daemon and a fake runtime: more than the default 5 s.
setDefaultTimeout(30_000);

const TOKEN = "run-daemon-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const YAML = `run:
  - name: web
    cmd: ["serve", "--port", "{{port.web}}"]
ports: [web]
`;
const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

describe("run-daemon: a configuração do host", () => {
  const write = (extra: Record<string, unknown>) => {
    const dir = tempDir();
    const file = join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ port: 0, token: "t".repeat(32), ...extra }));
    return file;
  };

  test("run.portBase começa em 41000, aceita uma faixa em que o bloco de 10 cabe e recusa o resto", () => {
    expect(loadConfig(write({})).run.portBase).toBe(41000);
    expect(loadConfig(write({ run: { portBase: 52000 } })).run.portBase).toBe(52000);
    expect(() => loadConfig(write({ run: { portBase: 80 } }))).toThrow();
    expect(() => loadConfig(write({ run: { portBase: 65530 } }))).toThrow();
    expect(() => loadConfig(write({ run: { portBase: 41000.5 } }))).toThrow();
  });
});

/** A daemon over a repository whose run.yaml is committed, on fake PTYs and a free-port probe. */
async function daemon() {
  const { root, repo } = gitRepo();
  mkdirSync(join(repo, ".flightdeck"), { recursive: true });
  writeFileSync(join(repo, ".flightdeck", "run.yaml"), YAML);
  git(repo, "add", ".flightdeck");
  git(repo, "commit", "-q", "-m", "run.yaml");
  const dir = tempDir();
  const file = join(dir, "config.json");
  writeFileSync(
    file,
    JSON.stringify({
      port: 0,
      token: TOKEN,
      dataDir: join(dir, "data"),
      allowedRoots: [root],
      runtime: "fake",
      run: { portBase: 52000 },
    }),
  );
  const ptys = fakePtys();
  const running = await startDaemon(
    { command: "start", config: file, runtime: "fake" },
    {},
    { log: () => {}, error: () => {} },
    { pty: ptys.factory, portProbe: async () => true },
  );
  cleanups.push(() => running.stop());
  const client = new FrameClient(`ws://127.0.0.1:${new URL(running.url).port}/v1/ws`);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "t" });
  const project = await client.data<{ id: string }>("project.add", { path: repo });
  const projectId = project?.id ?? "";
  /** A card with its worktree (a started card of the fake runtime). */
  const card = async (title: string) => {
    const created = await client.data<{ id: string }>("card.create", {
      projectId,
      title,
      description: "faça",
    });
    const id = created?.id ?? "";
    await client.data("card.start", { cardId: id });
    let worktree = "";
    for (let i = 0; i < 200 && !worktree; i++) {
      const got = await client.data<{ worktreePath: string | null }>("card.get", { cardId: id });
      worktree = got?.worktreePath ?? "";
      if (!worktree) await Bun.sleep(50);
    }
    // The loop above waits for the path; if it never came, stop here rather than go on with "".
    return { id, worktree: must(worktree, "worktreePath") };
  };
  return { client, ptys, projectId, card };
}

interface WireRun {
  status: string;
  ports: Record<string, number>;
}

describe("run-daemon: o daemon liga tudo", () => {
  test("host.info anuncia runenv e o card roda pelo terminal do host, na worktree, com o bloco de portas de run.portBase", async () => {
    const { client, ptys, projectId, card } = await daemon();
    const info = await client.data<{ features: string[] }>("host.info", {});
    expect(info?.features).toContain("runenv");
    await client.data("runenv.trust", { projectId, hash: sha256(YAML) });
    const a = await card("A");
    const run = await client.data<WireRun>("runenv.start", { cardId: a.id });
    expect(run).toMatchObject({ status: "running", ports: { web: 52000 } });
    expect(ptys.spawned[0]?.argv).toEqual(["serve", "--port", "52000"]);
    expect(ptys.spawned[0]?.cwd).toBe(a.worktree);
    const terminals = await client.data<{ terminals: Array<{ command: string }> }>(
      "terminal.list",
      {},
    );
    expect(terminals?.terminals.map((t) => t.command)).toEqual(["serve"]);
    const stopped = await client.data<WireRun>("runenv.stop", { cardId: a.id });
    expect(stopped?.status).toBe("ended");
    expect(ptys.spawned[0]?.killed).toBe(true);
  });

  test("o card que chega a done devolve o bloco de portas e para o que rodava", async () => {
    const { client, ptys, projectId, card } = await daemon();
    await client.data("runenv.trust", { projectId, hash: sha256(YAML) });
    const a = await card("A");
    const b = await card("B");
    expect((await client.data<WireRun>("runenv.start", { cardId: a.id }))?.ports.web).toBe(52000);
    expect((await client.data<WireRun>("runenv.start", { cardId: b.id }))?.ports.web).toBe(52010);
    await client.data("card.move", { cardId: a.id, column: "done" });
    let status = "";
    for (let i = 0; i < 100 && status !== "ended"; i++) {
      status = (await client.data<WireRun>("runenv.get", { cardId: a.id }))?.status ?? "";
      if (status !== "ended") await Bun.sleep(20);
    }
    expect(status).toBe("ended");
    expect(ptys.spawned[0]?.killed).toBe(true);
    expect(ptys.spawned[1]?.killed).toBe(false);
    const c = await card("C");
    expect((await client.data<WireRun>("runenv.start", { cardId: c.id }))?.ports.web).toBe(52000);
  });

  test("a discarded card stops what it ran, before its worktree goes, and gives its ports back", async () => {
    const { client, ptys, projectId, card } = await daemon();
    await client.data("runenv.trust", { projectId, hash: sha256(YAML) });
    const a = await card("A");
    expect((await client.data<WireRun>("runenv.start", { cardId: a.id }))?.ports.web).toBe(52000);
    await client.data("card.discard", { cardId: a.id, confirm: true });
    expect(ptys.spawned[0]?.killed).toBe(true);
    expect(existsSync(a.worktree)).toBe(false);
    const b = await card("B");
    expect((await client.data<WireRun>("runenv.start", { cardId: b.id }))?.ports.web).toBe(52000);
  });
});
