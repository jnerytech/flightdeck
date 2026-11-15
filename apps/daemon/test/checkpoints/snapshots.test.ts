import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Central } from "../../src/central/central.ts";
import { Snapshots } from "../../src/checkpoints/snapshots.ts";
import { Maintenance } from "../../src/maintenance/maintenance.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { git, gitRepo } from "../support/board-helpers.ts";
import { newManager, poll, tempDir } from "../support/helpers.ts";

const DAY = 86_400_000;
const sha = (path: string) =>
  new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

function setup(opts: { maxBytes?: number } = {}) {
  const store = new EventStore(":memory:");
  cleanups.push(() => store.close());
  let now = Date.parse("2026-11-03T10:00:00.000Z");
  const snapshots = new Snapshots({ db: store.db, now: () => now, ...opts });
  const { repo } = gitRepo();
  return {
    snapshots,
    repo,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** What the user sees: status, index bytes and the content of every file touched. */
function userState(repo: string, files: string[]) {
  return {
    status: git(repo, "status", "--porcelain", "--untracked-files=all"),
    index: sha(join(repo, ".git", "index")),
    files: files.map((f) => sha(join(repo, f))),
  };
}

describe("snapshots", () => {
  test("snapshot sem mudar índice nem arquivos; inclui não rastreados e respeita ignorados", async () => {
    const { snapshots, repo } = setup();
    writeFileSync(join(repo, "README.md"), "# repo editado\n");
    writeFileSync(join(repo, "novo.txt"), "não rastreado\n");
    mkdirSync(join(repo, "node_modules"));
    writeFileSync(join(repo, "node_modules", "lixo.js"), "ignorado\n");
    git(repo, "add", "README.md"); // staged, so the user's index differs from HEAD
    const files = ["README.md", "novo.txt", "node_modules/lixo.js"];
    const before = userState(repo, files);
    const result = await snapshots.take({
      cwd: repo,
      claudeSessionId: "s1",
      kind: "before",
      prompt: "edite o README",
    });
    expect(userState(repo, files)).toEqual(before);
    expect(result).toMatchObject({
      row: { claudeSessionId: "s1", n: 1, kind: "before", prompt: "edite o README" },
    });
    const ref = "refs/flightdeck/snapshots/s1/1";
    expect(git(repo, "show", `${ref}:README.md`)).toBe("# repo editado");
    expect(git(repo, "show", `${ref}:novo.txt`)).toBe("não rastreado");
    expect(git(repo, "ls-tree", "-r", "--name-only", ref)).not.toContain("node_modules");
    // The snapshot is a child of HEAD, and HEAD did not move.
    expect(git(repo, "rev-parse", `${ref}^`)).toBe(git(repo, "rev-parse", "HEAD"));
    expect(git(repo, "log", "--oneline")).not.toContain("flightdeck snapshot");
  });

  test("árvore igual à do snapshot anterior não cria ref; registra o turno no mesmo ref", async () => {
    const { snapshots, repo } = setup();
    writeFileSync(join(repo, "a.txt"), "1\n");
    await snapshots.take({ cwd: repo, claudeSessionId: "s1", kind: "before" });
    const same = await snapshots.take({ cwd: repo, claudeSessionId: "s1", kind: "after" });
    expect(same).toMatchObject({ row: { n: 2, ref: "refs/flightdeck/snapshots/s1/1" } });
    expect(git(repo, "for-each-ref", "refs/flightdeck")).not.toContain("s1/2");
    writeFileSync(join(repo, "a.txt"), "2\n");
    const changed = await snapshots.take({ cwd: repo, claudeSessionId: "s1", kind: "before" });
    expect(changed).toMatchObject({ row: { n: 3, ref: "refs/flightdeck/snapshots/s1/3" } });
    expect(snapshots.list("s1").map((s) => [s.n, s.kind])).toEqual([
      [1, "before"],
      [2, "after"],
      [3, "before"],
    ]);
  });

  test("fora de um repositório, ou com mudanças acima do limite, pula e diz o motivo", async () => {
    const { snapshots } = setup();
    expect(await snapshots.take({ cwd: tempDir(), claudeSessionId: "s1", kind: "before" })).toEqual(
      {
        skipped: "fora de um repositório git",
      },
    );
    const small = setup({ maxBytes: 10 });
    writeFileSync(join(small.repo, "grande.bin"), "x".repeat(100));
    const skipped = await small.snapshots.take({
      cwd: small.repo,
      claudeSessionId: "s1",
      kind: "before",
    });
    expect(skipped).toEqual({ skipped: "mudanças acima do limite de 10 bytes" });
    expect(git(small.repo, "for-each-ref", "refs/flightdeck")).toBe("");
  });

  test("retenção: 50 por sessão e 30 dias, apagando os refs junto", async () => {
    const { snapshots, repo, advance } = setup();
    for (let i = 0; i < 52; i++) {
      writeFileSync(join(repo, "a.txt"), `${i}\n`);
      await snapshots.take({ cwd: repo, claudeSessionId: "s1", kind: "before" });
    }
    writeFileSync(join(repo, "b.txt"), "velho\n");
    await snapshots.take({ cwd: repo, claudeSessionId: "velha", kind: "before" });
    advance(10 * DAY);
    expect(await snapshots.prune({ perSession: 50, days: 30 })).toBe(2);
    expect(snapshots.list("s1").map((s) => s.n)[0]).toBe(3);
    expect(git(repo, "for-each-ref", "refs/flightdeck/snapshots/s1/1")).toBe("");
    advance(25 * DAY);
    expect(await snapshots.prune({ perSession: 50, days: 30 })).toBe(51);
    expect(snapshots.list("velha")).toEqual([]);
    expect(git(repo, "for-each-ref", "refs/flightdeck")).toBe("");
  }, 60_000);

  test("enfileirar volta na hora; o snapshot sai em segundo plano, um de cada vez", async () => {
    const { snapshots, repo } = setup();
    writeFileSync(join(repo, "a.txt"), "1\n");
    const started = performance.now();
    snapshots.enqueue({ cwd: repo, claudeSessionId: "s1", kind: "before", prompt: "um" });
    snapshots.enqueue({ cwd: repo, claudeSessionId: "s1", kind: "after" });
    expect(performance.now() - started).toBeLessThan(20);
    expect(snapshots.list("s1")).toEqual([]);
    await snapshots.idle();
    expect(snapshots.list("s1").map((s) => s.kind)).toEqual(["before", "after"]);
    // A failing snapshot never breaks the queue.
    snapshots.enqueue({ cwd: join(repo, "nao-existe"), claudeSessionId: "s1", kind: "before" });
    snapshots.enqueue({ cwd: repo, claudeSessionId: "s1", kind: "after" });
    await snapshots.idle();
    expect(snapshots.list("s1")).toHaveLength(3);
  });

  test("hooks do terminal: UserPromptSubmit enfileira o antes, Stop o depois; sessão gerenciada não", async () => {
    const { snapshots, repo } = setup();
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    const { manager } = newManager({ store });
    const dir = tempDir();
    const configFile = join(dir, "config.json");
    writeFileSync(configFile, "{}");
    const central = new Central({
      db: store.db,
      manager,
      hooks: { port: 0, token: "tok-snapshots", permissionTimeoutS: 600, staleAfterS: 900 },
      dataDir: join(dir, "data"),
      hostName: "h",
      configFile,
      selfCommand: ["flightdeckd"],
      settingsPath: () => join(dir, "settings.json"),
      snapshots,
    });
    cleanups.push(() => central.stop());
    const post = (event: string, payload: object) =>
      fetch(`${central.receptor?.url}/hooks/${event}`, {
        method: "POST",
        headers: { authorization: "Bearer tok-snapshots" },
        body: JSON.stringify({ hook_event_name: event, ...payload }),
      });
    writeFileSync(join(repo, "a.txt"), "1\n");
    await post("UserPromptSubmit", { session_id: "t1", cwd: repo, prompt: "crie b.txt" });
    writeFileSync(join(repo, "b.txt"), "novo\n");
    await post("Stop", { session_id: "t1", cwd: repo });
    await snapshots.idle();
    expect(snapshots.list("t1").map((s) => [s.kind, s.prompt])).toEqual([
      ["before", "crie b.txt"],
      ["after", null],
    ]);
  });

  test("sessão gerenciada: antes de cada turno (o primeiro espera o session.init) e depois dele", async () => {
    const edges: Array<{ kind: string; prompt?: string; claudeSessionId: string }> = [];
    const { manager, project } = newManager({
      onTurnEdge: (edge) =>
        edges.push({ kind: edge.kind, prompt: edge.prompt, claudeSessionId: edge.claudeSessionId }),
    });
    const { sessionId } = await manager.create({ cwd: project, prompt: "primeiro" });
    await poll(() => manager.get(sessionId).status === "idle", 3000);
    manager.send(sessionId, "segundo");
    await poll(() => edges.length === 4, 3000);
    const claude = manager.get(sessionId).claudeSessionId;
    expect(edges).toEqual([
      { kind: "before", prompt: "primeiro", claudeSessionId: claude as string },
      { kind: "after", prompt: undefined, claudeSessionId: claude as string },
      { kind: "before", prompt: "segundo", claudeSessionId: claude as string },
      { kind: "after", prompt: undefined, claudeSessionId: claude as string },
    ]);
  });

  test("a manutenção diária limpa os snapshots junto com a retenção", async () => {
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    const policies: unknown[] = [];
    const maintenance = new Maintenance({
      db: store.db,
      dataDir: tempDir(),
      retention: { eventsDays: 90, externalSessionsDays: 30, usageDays: 400 },
      snapshots: {
        prune: async (policy) => {
          policies.push(policy);
          return 0;
        },
      },
    });
    await maintenance.start();
    maintenance.stop();
    expect(policies).toEqual([{ perSession: 50, days: 30 }]);
  });
});

describe("snapshots: pruning", () => {
  test("pruning a snapshot whose repository is gone drops the row and runs no git", async () => {
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    let now = Date.parse("2026-11-03T10:00:00.000Z");
    const snapshots = new Snapshots({ db: store.db, now: () => now });
    const { repo } = gitRepo();
    writeFileSync(join(repo, "a.txt"), "1\n");
    await snapshots.take({ cwd: repo, claudeSessionId: "s1", kind: "before" });
    rmSync(repo, { recursive: true, force: true });
    now += 40 * 86_400_000;
    expect(await snapshots.prune({ perSession: 50, days: 30 })).toBe(1);
    expect(snapshots.list("s1")).toEqual([]);
  });
});
