import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Rewinder } from "../../src/checkpoints/rewind.ts";
import { Snapshots } from "../../src/checkpoints/snapshots.ts";
import { FakeRuntime } from "../../src/runtime/fake-runtime.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { git, gitRepo } from "../support/board-helpers.ts";
import { cleanups, runCleanups, turnInRepo } from "../support/checkpoints-rewind.ts";
import { newManager, poll, tempDir } from "../support/helpers.ts";

afterEach(runCleanups);
const read = (path: string) => readFileSync(path, "utf8");
/** A repo where `before` runs, the `before` snapshot is taken, and then `after` runs. */
async function turnWith(before: (repo: string) => void, after: (repo: string) => void) {
  const store = new EventStore(":memory:");
  cleanups.push(() => store.close());
  const snapshots = new Snapshots({ db: store.db });
  const { repo } = gitRepo();
  before(repo);
  const taken = await snapshots.take({ cwd: repo, claudeSessionId: "s1", kind: "before" });
  after(repo);
  const turn = "row" in taken ? taken.row.n : -1;
  const sessions = { busy: () => false, rewindFiles: async () => null };
  return {
    repo,
    turn,
    rewinder: new Rewinder({ snapshots, sessions, allowedRoots: [dirname(repo)] }),
  };
}

async function reason(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return (error as { reason?: string }).reason ?? (error as Error).message;
  }
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).message;
  }
}

describe("rewind", () => {
  test("prévia pelo snapshot: arquivos que mudam, inserções e remoções, sem tocar em nada", async () => {
    const { rewinder, repo, turn } = await turnInRepo();
    const preview = await rewinder.preview("s1", turn);
    expect(preview).toEqual({
      via: "snapshot",
      files: [
        { path: "README.md", change: "modified" },
        { path: "apagar.txt", change: "deleted" },
        { path: "novo.txt", change: "created" },
      ],
      // What the rewind does: puts back apagar.txt's line, removes README's and novo.txt's.
      insertions: 1,
      deletions: 2,
    });
    expect(existsSync(join(repo, "novo.txt"))).toBe(true);
  });

  test("aplicar pelo snapshot restaura, remove o criado depois, guarda o snapshot de segurança, e desfazer volta", async () => {
    const { rewinder, repo, turn, snapshots } = await turnInRepo();
    expect(await code(rewinder.apply("s1", turn, false))).toBe("invalid_state");
    expect(existsSync(join(repo, "novo.txt"))).toBe(true);
    const applied = await rewinder.apply("s1", turn, true);
    expect(applied.via).toBe("snapshot");
    expect(read(join(repo, "README.md"))).toBe("# repo\n");
    expect(read(join(repo, "apagar.txt"))).toBe("vai sumir\n");
    expect(existsSync(join(repo, "novo.txt"))).toBe(false);
    // Ignored files are never touched.
    expect(read(join(repo, "node_modules", "lixo.js"))).toBe("ignorado\n");
    expect(snapshots.list("s1").at(-1)?.kind).toBe("safety");
    expect(await code(rewinder.undo("s1", false))).toBe("invalid_state");
    await rewinder.undo("s1", true);
    expect(read(join(repo, "README.md"))).toBe("# repo\nlinha nova\n");
    expect(read(join(repo, "novo.txt"))).toBe("criado no turno\n");
    expect(existsSync(join(repo, "apagar.txt"))).toBe(false);
  });

  test("recusa com turno em andamento, turno desconhecido e desfazer sem volta anterior", async () => {
    const busy = await turnInRepo({ busy: () => true, rewindFiles: async () => null });
    expect(await code(busy.rewinder.apply("s1", busy.turn, true))).toBe("invalid_state");
    const { rewinder } = await turnInRepo();
    expect(await code(rewinder.preview("s1", 99))).toBe("not_found");
    expect(await code(rewinder.undo("s1", true))).toBe("not_found");
  });

  test("sem snapshot de segurança possível (mudanças acima do limite), não volta nada", async () => {
    const { store, repo, turn } = await turnInRepo();
    const tiny = new Snapshots({ db: store.db, maxBytes: 1 });
    const rewinder = new Rewinder({
      snapshots: tiny,
      sessions: { busy: () => false, rewindFiles: async () => null },
      allowedRoots: [dirname(repo)],
    });
    expect(await code(rewinder.apply("s1", turn, true))).toBe("invalid_state");
    expect(existsSync(join(repo, "novo.txt"))).toBe(true);
  });

  test("sessão gerenciada viva: usa o rewindFiles do SDK (prévia e real); sem poder, cai no snapshot", async () => {
    const calls: Array<{ id: string; dryRun: boolean }> = [];
    let canRewind = true;
    const runtime = new FakeRuntime({
      delayMs: 1,
      rewind: (id, dryRun) => {
        calls.push({ id, dryRun });
        return canRewind
          ? { canRewind: true, filesChanged: ["README.md"], insertions: 0, deletions: 1 }
          : { canRewind: false, error: "sem checkpoint" };
      },
    });
    const store = new EventStore(":memory:");
    cleanups.push(() => store.close());
    const { repo } = gitRepo();
    const { manager } = newManager({ store, runtime, allowedRoots: [dirname(repo)] });
    const { sessionId } = await manager.create({ cwd: repo, prompt: "oi" });
    await poll(() => manager.get(sessionId).status === "idle", 3000);
    const claude = manager.get(sessionId).claudeSessionId as string;
    const snapshots = new Snapshots({ db: store.db });
    const before = await snapshots.take({
      cwd: repo,
      claudeSessionId: claude,
      kind: "before",
      turnUuid: "uuid-turno-1",
    });
    const turn = "row" in before ? before.row.n : -1;
    const rewinder = new Rewinder({ snapshots, sessions: manager, allowedRoots: [dirname(repo)] });
    expect(await rewinder.preview(claude, turn)).toEqual({
      via: "sdk",
      files: [{ path: "README.md", change: "modified" }],
      insertions: 0,
      deletions: 1,
    });
    expect((await rewinder.apply(claude, turn, true)).via).toBe("sdk");
    expect(calls).toEqual([
      { id: "uuid-turno-1", dryRun: true },
      { id: "uuid-turno-1", dryRun: false },
    ]);
    canRewind = false;
    expect((await rewinder.preview(claude, turn)).via).toBe("snapshot");
  });

  test("cada turno gerenciado leva um uuid novo, que vai junto do snapshot antes", async () => {
    const edges: Array<{ kind: string; turnUuid?: string }> = [];
    const { manager, project } = newManager({
      onTurnEdge: (edge) => edges.push({ kind: edge.kind, turnUuid: edge.turnUuid }),
    });
    const { sessionId } = await manager.create({ cwd: project, prompt: "um" });
    await poll(() => manager.get(sessionId).status === "idle", 3000);
    manager.send(sessionId, "dois");
    await poll(() => edges.length === 4, 3000);
    const uuids = edges.filter((e) => e.kind === "before").map((e) => e.turnUuid);
    expect(uuids).toHaveLength(2);
    expect(uuids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(uuids[0]).not.toBe(uuids[1]);
    expect(edges.filter((e) => e.kind === "after").map((e) => e.turnUuid)).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe("rewind: odd names and links (#3024)", () => {
  const NAMES = ["café.txt", 'a"b.txt', "a\nb.txt", "tab\there.txt", "back\\slash.txt"];

  test("a name with an accent, quote, newline, tab or backslash is previewed, restored and removed under its real name", async () => {
    const { rewinder, repo, turn } = await turnWith(
      (dir) => {
        for (const name of NAMES) writeFileSync(join(dir, name), `before ${name}\n`);
      },
      (dir) => {
        for (const name of NAMES) writeFileSync(join(dir, name), `after ${name}\n`);
        writeFileSync(join(dir, "novo-é.txt"), "created\n");
      },
    );
    const preview = await rewinder.preview("s1", turn);
    expect(preview.files.map((f) => f.path).sort()).toEqual([...NAMES, "novo-é.txt"].sort());
    await rewinder.apply("s1", turn, true);
    for (const name of NAMES) expect(read(join(repo, name))).toBe(`before ${name}\n`);
    expect(existsSync(join(repo, "novo-é.txt"))).toBe(false);
    expect(readdirSync(repo).filter((n) => n.startsWith('"'))).toEqual([]);
  });

  test("a git diff that fails is an error for the preview and the rewind, which restores nothing", async () => {
    const { store, rewinder, repo, turn } = await turnInRepo();
    // The target's tree is something git cannot read: both diffs exit non-zero.
    store.db.run("UPDATE snapshots SET tree = ? WHERE kind = 'before'", ["0".repeat(40)]);
    expect(await code(rewinder.preview("s1", turn))).not.toBe("ok");
    expect(await code(rewinder.apply("s1", turn, true))).not.toBe("ok");
    expect(read(join(repo, "README.md"))).toBe("# repo\nlinha nova\n");
    expect(existsSync(join(repo, "novo.txt"))).toBe(true);
    expect(existsSync(join(repo, "apagar.txt"))).toBe(false);
  });

  test("a snapshot blob that cannot be read stops the rewind and writes nothing", async () => {
    const { rewinder, repo, turn } = await turnWith(
      (dir) => writeFileSync(join(dir, "gone.txt"), "only in the snapshot\n"),
      (dir) => writeFileSync(join(dir, "gone.txt"), "changed after\n"),
    );
    // The blob of the "before" content: hash it from a temporary file, then remove its loose object.
    const copy = join(tempDir("fd-rewind-blob-"), "before.txt");
    writeFileSync(copy, "only in the snapshot\n");
    const before = git(repo, "hash-object", copy).trim();
    rmSync(join(repo, ".git", "objects", before.slice(0, 2), before.slice(2)), { force: true });
    expect(await reason(rewinder.apply("s1", turn, true))).toBe("rewind_blob_unreadable");
    expect(read(join(repo, "gone.txt"))).toBe("changed after\n");
  });

  test.skipIf(process.platform === "win32")(
    "a folder that became a link out of the repo is not written through, and undo leaves the outside alone",
    async () => {
      const outside = tempDir("fd-rewind-outside-");
      const { rewinder, repo, turn } = await turnWith(
        (dir) => {
          mkdirSync(join(dir, "d"));
          writeFileSync(join(dir, "d", "f"), "inside\n");
        },
        (dir) => {
          rmSync(join(dir, "d"), { recursive: true });
          symlinkSync(outside, join(dir, "d"));
        },
      );
      expect(await reason(rewinder.apply("s1", turn, true))).toBe("rewind_through_link");
      expect(readdirSync(outside)).toEqual([]);
      await rewinder.undo("s1", true);
      expect(readdirSync(outside)).toEqual([]);
      expect(existsSync(join(repo, "d", "f"))).toBe(false);
    },
  );

  test.skipIf(process.platform === "win32")(
    "a file that became a link to a file out of the repo is not written through",
    async () => {
      const outside = join(tempDir("fd-rewind-outside-"), "target.txt");
      writeFileSync(outside, "outside\n");
      const { rewinder, turn } = await turnWith(
        (dir) => writeFileSync(join(dir, "f"), "inside\n"),
        (dir) => {
          rmSync(join(dir, "f"));
          symlinkSync(outside, join(dir, "f"));
        },
      );
      expect(await reason(rewinder.apply("s1", turn, true))).toBe("rewind_through_link");
      expect(read(outside)).toBe("outside\n");
    },
  );

  test.skipIf(process.platform === "win32")(
    "a link created after the turn is removed as a link, never followed",
    async () => {
      const outside = join(tempDir("fd-rewind-outside-"), "target.txt");
      writeFileSync(outside, "outside\n");
      const { rewinder, repo, turn } = await turnWith(
        () => undefined,
        (dir) => symlinkSync(outside, join(dir, "novo-link")),
      );
      await rewinder.apply("s1", turn, true);
      expect(existsSync(join(repo, "novo-link"))).toBe(false);
      expect(read(outside)).toBe("outside\n");
    },
  );
});

describe("rewind: the snapshot's repository must sit inside allowedRoots (#3554)", () => {
  const refsOf = (repo: string) => git(repo, "for-each-ref", "--format=%(refname)");
  /** The same snapshots, behind roots that may no longer cover the repository. */
  const behind = (snapshots: Snapshots, roots: string[]) =>
    new Rewinder({
      snapshots,
      sessions: { busy: () => false, rewindFiles: async () => null },
      allowedRoots: roots,
    });

  test("apply into a repository outside every root is refused, with no safety ref and no file written", async () => {
    const { rewinder, snapshots, repo, turn } = await turnInRepo();
    const refs = refsOf(repo);
    const outside = behind(snapshots, [tempDir("fd-rewind-other-root-")]);
    expect(await reason(outside.apply("s1", turn, true))).toBe("cwd_outside_roots");
    expect(await code(outside.apply("s1", turn, true))).toBe("forbidden_cwd");
    expect(refsOf(repo)).toBe(refs);
    expect(existsSync(join(repo, "novo.txt"))).toBe(true);
    expect(read(join(repo, "README.md"))).toBe("# repo\nlinha nova\n");
  });

  test("apply into a repository above the only root is refused: a root inside the repository does not allow the whole repository", async () => {
    const { rewinder, snapshots, repo, turn } = await turnInRepo();
    const inner = join(repo, "sub");
    mkdirSync(inner);
    expect(await reason(behind(snapshots, [inner]).apply("s1", turn, true))).toBe(
      "cwd_outside_roots",
    );
    expect(existsSync(join(repo, "novo.txt"))).toBe(true);
  });

  test("undo of a rewind is refused the same way once the repository left the roots, and writes nothing", async () => {
    const { rewinder, snapshots, repo, turn } = await turnInRepo();
    await rewinder.apply("s1", turn, true);
    expect(existsSync(join(repo, "novo.txt"))).toBe(false);
    const refs = refsOf(repo);
    const outside = behind(snapshots, [tempDir("fd-rewind-other-root-")]);
    expect(await reason(outside.undo("s1", true))).toBe("cwd_outside_roots");
    expect(existsSync(join(repo, "novo.txt"))).toBe(false);
    expect(refsOf(repo)).toBe(refs);
  });

  test("a repository that is gone inside a root is refused as missing, with nothing written", async () => {
    const { rewinder, snapshots, repo, turn } = await turnInRepo();
    rmSync(repo, { recursive: true, force: true });
    expect(await reason(rewinder.apply("s1", turn, true))).toBe("cwd_missing");
    expect(existsSync(repo)).toBe(false);
  });

  test.skipIf(process.platform === "win32")(
    "a repository that is a link leading outside the root is refused",
    async () => {
      const { rewinder, snapshots, repo, turn, store } = await turnInRepo();
      const root = tempDir("fd-rewind-root-");
      const link = join(root, "linked");
      symlinkSync(repo, link);
      store.db.run("UPDATE snapshots SET repo = ? WHERE claude_session_id = 's1'", [link]);
      expect(await reason(behind(snapshots, [root]).apply("s1", turn, true))).toBe(
        "cwd_outside_roots",
      );
      expect(existsSync(join(repo, "novo.txt"))).toBe(true);
    },
  );

  test("apply inside a root still goes back, and the preview stays a read that checks no root", async () => {
    const { rewinder, snapshots, repo, turn } = await turnInRepo();
    const outside = behind(snapshots, [tempDir("fd-rewind-other-root-")]);
    expect((await outside.preview("s1", turn)).via).toBe("snapshot");
    await rewinder.apply("s1", turn, true);
    expect(existsSync(join(repo, "novo.txt"))).toBe(false);
  });
});

describe("rewind guard (#3825)", () => {
  const refuse = () => {
    throw new Error("guard ran");
  };

  test("the guard runs, before anything is written, when the rewind would put back Claude Code's settings, by apply and by undo", async () => {
    const { rewinder, repo, turn } = await turnWith(
      (dir) => {
        mkdirSync(join(dir, ".claude"));
        writeFileSync(join(dir, ".claude", "settings.json"), "{}\n");
        writeFileSync(join(dir, "a.txt"), "original\n");
      },
      (dir) => {
        writeFileSync(join(dir, ".claude", "settings.json"), '{"hooks":{}}\n');
        writeFileSync(join(dir, "a.txt"), "edited\n");
      },
    );
    const refused = await reason(rewinder.apply("s1", turn, true, refuse));
    expect([
      refused,
      read(join(repo, ".claude", "settings.json")),
      read(join(repo, "a.txt")),
    ]).toEqual(["guard ran", '{"hooks":{}}\n', "edited\n"]);
    expect(await reason(rewinder.apply("s1", turn, true))).toBe("ok");
    expect(await reason(rewinder.undo("s1", true, refuse))).toBe("guard ran");
    expect(read(join(repo, ".claude", "settings.json"))).toBe("{}\n");
  });

  test("the guard also runs for a file another hard link shares, and stays quiet for a plain file", async () => {
    const { rewinder, repo, turn } = await turnWith(
      (dir) => {
        writeFileSync(join(dir, "x.txt"), "one\n");
        linkSync(join(dir, "x.txt"), join(dir, "twin.txt"));
        writeFileSync(join(dir, "plain.txt"), "p\n");
      },
      (dir) => {
        writeFileSync(join(dir, "x.txt"), "two\n");
      },
    );
    expect(await reason(rewinder.apply("s1", turn, true, refuse))).toBe("guard ran");
    expect(read(join(repo, "twin.txt"))).toBe("two\n");
    const plain = await turnWith(
      (dir) => writeFileSync(join(dir, "plain.txt"), "p\n"),
      (dir) => writeFileSync(join(dir, "plain.txt"), "q\n"),
    );
    expect(await reason(plain.rewinder.apply("s1", plain.turn, true, refuse))).toBe("ok");
    expect(read(join(plain.repo, "plain.txt"))).toBe("p\n");
  });
});
