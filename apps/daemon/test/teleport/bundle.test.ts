import { describe, expect, test } from "bun:test";
import { cpSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bundleCode } from "../src/teleport/bundle.ts";
import { git, gitRepo, gitRepoWithOrigin } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";

/**
 * Issue #100, slice 1b: the code of a teleported session travels as one git bundle: the commits
 * HEAD has beyond its base on origin, and a WIP commit of the working tree (changed and untracked
 * files, never ignored ones) built in a temporary index. The person's index, stash and refs are as
 * they were; the target fetches the bundle and restores the working tree from the WIP commit.
 */
const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

/** A repository on a branch two commits past origin/main, with a change, a new file and an ignored one. */
async function working() {
  const { repo, remote } = gitRepoWithOrigin();
  git(repo, "checkout", "-q", "-b", "feature");
  for (const n of [1, 2]) {
    await writeFile(join(repo, `f${n}.txt`), `${n}\n`);
    git(repo, "add", `f${n}.txt`);
    git(repo, "commit", "-q", "-m", `feat(x): ${n}`);
  }
  await writeFile(join(repo, ".gitignore"), "secret.env\n");
  git(repo, "add", ".gitignore");
  git(repo, "commit", "-q", "-m", "chore(x): ignore");
  await writeFile(join(repo, "f1.txt"), "1 changed\n");
  await writeFile(join(repo, "new.txt"), `token ${TOKEN}\n`);
  await writeFile(join(repo, "secret.env"), "KEY=hidden\n");
  const folder = tempDir("fd-teleport-code-");
  return { repo, remote, folder };
}

const state = (repo: string) => [
  git(repo, "status", "--porcelain"),
  git(repo, "for-each-ref", "refs/flightdeck"),
  git(repo, "stash", "list"),
  git(repo, "rev-parse", "HEAD"),
];

const reason = (run: () => Promise<unknown>) =>
  run().then(
    () => "no refusal",
    (error: { reason?: string }) => error.reason ?? String(error),
  );

describe("teleport-bundle: a daemon that stops kills the git calls (#715)", () => {
  test("a signal that has fired stops the bundle, and the person's repo is as it was", async () => {
    const { repo, folder } = await working();
    const before = state(repo);
    const refusal = await reason(() =>
      bundleCode({
        cwd: repo,
        folder,
        id: "pkg-1",
        scan: () => [],
        signal: AbortSignal.abort(),
      }),
    );
    expect([refusal, state(repo), await readdir(folder)]).toEqual(["teleport_stopped", before, []]);
  });

  test("what a git killed half way left in the package's folder goes with it: the copy of the index and its lock", async () => {
    const { repo, folder } = await working();
    await writeFile(join(folder, "index"), "a copy of the index");
    await writeFile(join(folder, "index.lock"), "");
    const refusal = await reason(() =>
      bundleCode({ cwd: repo, folder, id: "pkg-1", scan: () => [], signal: AbortSignal.abort() }),
    );
    expect([refusal, await readdir(folder)]).toEqual(["teleport_stopped", []]);
  });
});

/** Whether the repository has an object (a blob, a tree or a commit) in its own store. */
const has = (repo: string, sha: string) => {
  try {
    git(repo, "cat-file", "-e", sha);
    return true;
  } catch {
    return false;
  }
};

describe("teleport-bundle: the person's repository keeps no object of the bundle (#715)", () => {
  test("the new files, the tree and the WIP commit are built in a temporary object folder", async () => {
    const { repo, folder } = await working();
    const blob = git(repo, "hash-object", join(repo, "new.txt")).trim();
    const code = await bundleCode({ cwd: repo, folder, id: "pkg-1", scan: () => [] });
    const wip = git(repo, "bundle", "list-heads", code.file).split(" ")[0] ?? "";
    // The bundle holds the file all the same: a clone of it restores it.
    const verified = (() => {
      try {
        git(repo, "bundle", "verify", code.file);
        return true;
      } catch {
        return false;
      }
    })();
    expect([
      has(repo, blob),
      wip.length === 40 && has(repo, wip),
      verified,
      await readdir(folder),
    ]).toEqual([false, false, true, ["code"]]);
  });
});

describe("teleport-bundle: the person's repository never holds the bundle's ref or reads a split path (#715)", () => {
  test("the ref and the bundle are made in a repository of the package: every update-ref names its own git dir", async () => {
    const { repo, folder } = await working();
    // Git itself says, for each call, which repository it opened (GIT_TRACE_SETUP) and what it ran
    // (GIT_TRACE): no fake git, which on Windows would have to be a .cmd that Bun refuses to hand
    // an argument such as `origin/main^{commit}`.
    const log = join(tempDir("fd-trace-git-"), "trace.txt");
    const before = [process.env.GIT_TRACE, process.env.GIT_TRACE_SETUP];
    process.env.GIT_TRACE = log;
    process.env.GIT_TRACE_SETUP = log;
    try {
      await bundleCode({ cwd: repo, folder, id: "pkg-1", scan: () => [] });
    } finally {
      for (const [name, value] of [
        ["GIT_TRACE", before[0]],
        ["GIT_TRACE_SETUP", before[1]],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
    // The repository each `update-ref` opened: the last `git_dir` git named before it ran.
    const opened: string[] = [];
    let dir = "";
    for (const line of readFileSync(log, "utf8").split("\n")) {
      const named = /setup: git_dir: (.+)$/.exec(line);
      if (named) dir = (named[1] ?? "").replaceAll("\\", "/");
      else if (/trace: built-in: git update-ref/.test(line)) opened.push(dir);
    }
    expect([opened.length > 0, opened.every((path) => path.endsWith("/mirror"))]).toEqual([
      true,
      true,
    ]);
  });

  // Not on Windows: a colon cannot be in a Windows folder name, so no such repository exists there.
  test.skipIf(process.platform === "win32")(
    "a repository whose path holds a colon still bundles",
    async () => {
      const { repo, folder } = await working();
      const moved = join(tempDir("fd-colon-"), "proj:v2");
      cpSync(repo, moved, { recursive: true });
      expect(
        await reason(() => bundleCode({ cwd: moved, folder, id: "pkg-1", scan: () => [] })),
      ).toBe("no refusal");
    },
  );
});

describe("teleport-bundle: refs a dead daemon left are swept before the next bundle (#715)", () => {
  const aged = async (repo: string, name: string, hoursAgo: number) => {
    const head = git(repo, "rev-parse", "HEAD").trim();
    git(repo, "update-ref", `refs/flightdeck/teleport/${name}`, head);
    const file = join(
      git(repo, "rev-parse", "--absolute-git-dir").trim(),
      "refs/flightdeck/teleport",
      name,
    );
    const at = new Date(Date.now() - hoursAgo * 3_600_000);
    await utimes(file, at, at);
  };
  const refs = (repo: string) =>
    git(repo, "for-each-ref", "--format=%(refname)").trim().split("\n");

  test("only an old ref under refs/flightdeck/teleport goes; a young one, and every other ref, stay", async () => {
    const { repo, folder } = await working();
    await aged(repo, "old-1", 3);
    await aged(repo, "young-1", 0);
    git(repo, "update-ref", "refs/flightdeck/other/keep", git(repo, "rev-parse", "HEAD").trim());
    await bundleCode({ cwd: repo, folder, id: "pkg-2", scan: () => [] });
    expect(refs(repo).filter((ref) => ref.startsWith("refs/flightdeck"))).toEqual([
      "refs/flightdeck/other/keep",
      "refs/flightdeck/teleport/young-1",
    ]);
  });

  test("a refs folder that is a link is not followed", async () => {
    const { repo, folder } = await working();
    const gitDir = git(repo, "rev-parse", "--absolute-git-dir").trim();
    const elsewhere = tempDir("fd-refs-link-");
    const victim = join(elsewhere, "old-1");
    await writeFile(victim, `${git(repo, "rev-parse", "HEAD").trim()}\n`);
    const old = new Date(Date.now() - 5 * 3_600_000);
    await utimes(victim, old, old);
    await mkdir(join(gitDir, "refs/flightdeck"), { recursive: true });
    await symlink(elsewhere, join(gitDir, "refs/flightdeck/teleport"));
    await bundleCode({ cwd: repo, folder, id: "pkg-4", scan: () => [] });
    expect(await readdir(elsewhere)).toEqual(["old-1"]);
  });

  test("a ref whose object is gone is swept, and a name that is no package id is left alone, without stopping the bundle", async () => {
    const { repo, folder } = await working();
    const dir = join(
      git(repo, "rev-parse", "--absolute-git-dir").trim(),
      "refs/flightdeck/teleport",
    );
    await mkdir(dir, { recursive: true });
    // What a dead daemon leaves with the temporary object folder: a ref to an object nobody has.
    const broken = join(dir, "broken-1");
    await writeFile(broken, `${"1".repeat(40)}\n`);
    const old = new Date(Date.now() - 5 * 3_600_000);
    await utimes(broken, old, old);
    await mkdir(join(dir, "not an id"), { recursive: true });
    const code = await bundleCode({ cwd: repo, folder, id: "pkg-3", scan: () => [] });
    expect([code.size > 0, await readdir(dir)]).toEqual([true, ["not an id"]]);
  });
});

/** A repository on a branch of its own, level with origin/main, and a scan that counts token lines. */
function branched() {
  const { repo } = gitRepoWithOrigin();
  git(repo, "checkout", "-q", "-b", "feature");
  const folder = tempDir("fd-teleport-code-");
  const scan = (text: string) => (text.includes("ghp_") ? ["github_token"] : []);
  return { repo, folder, scan };
}

describe("teleport-bundle: what the scan and the counts read of the code (#715)", () => {
  test("a name with a line break in it is one changed file, not two", async () => {
    const { repo, folder, scan } = branched();
    // A line break cannot be part of a name on Windows.
    const odd = process.platform === "win32" ? "odd name.txt" : "odd\nname.txt";
    await writeFile(join(repo, odd), "one\n");
    await writeFile(join(repo, "plain.txt"), "two\n");
    const code = await bundleCode({ cwd: repo, folder, id: "pkg-1", scan });
    expect(code.changed).toBe(2);
  });

  test("an added line that starts with two plus signs is still scanned", async () => {
    const { repo, folder, scan } = branched();
    await writeFile(join(repo, "plus.txt"), `++${TOKEN}\nplain line\n`);
    // A tracked folder the person deleted: its files have no size and no folder to look in.
    await mkdir(join(repo, "gone"));
    await writeFile(join(repo, "gone", "old.txt"), "old\n");
    git(repo, "add", "gone/old.txt");
    git(repo, "commit", "-q", "-m", "feat(x): gone");
    await rm(join(repo, "gone"), { recursive: true });
    // Two files in one new folder: the folder is checked once.
    await mkdir(join(repo, "sub"));
    await writeFile(join(repo, "sub", "a.txt"), "a\n");
    await writeFile(join(repo, "sub", "b.txt"), "b\n");
    const code = await bundleCode({ cwd: repo, folder, id: "pkg-1", scan });
    expect(code.secrets.lines).toBe(1);
  });

  test("a secret added only in the resolution of a merge is scanned", async () => {
    const { repo, folder, scan } = branched();
    await writeFile(join(repo, "f1.txt"), "feature\n");
    git(repo, "add", "f1.txt");
    git(repo, "commit", "-q", "-m", "feat(x): f1");
    git(repo, "checkout", "-q", "-b", "side", "origin/main");
    await writeFile(join(repo, "f1.txt"), "side\n");
    git(repo, "add", "f1.txt");
    git(repo, "commit", "-q", "-m", "feat(x): f1 on the side");
    git(repo, "checkout", "-q", "feature");
    // The two f1.txt conflict: the resolution holds a line neither side has.
    try {
      git(repo, "merge", "-q", "--no-edit", "side");
    } catch {
      // The conflict is the point.
    }
    await writeFile(join(repo, "f1.txt"), `resolved ${TOKEN}\n`);
    git(repo, "add", "f1.txt");
    git(repo, "commit", "-q", "-m", "merge side");
    const code = await bundleCode({ cwd: repo, folder, id: "pkg-1", scan });
    expect(code.secrets.lines).toBe(1);
  });

  test("a file the repository marks as binary is still scanned", async () => {
    const { repo, folder, scan } = branched();
    // `-diff` makes git print "Binary files differ" for a match, a line a session can add itself.
    await writeFile(join(repo, ".gitattributes"), "*.env -diff\n");
    await writeFile(join(repo, "app.env"), `KEY=${TOKEN}\n`);
    const code = await bundleCode({ cwd: repo, folder, id: "pkg-1", scan });
    expect(code.secrets.lines).toBe(1);
  });

  test("a folder swapped for a link to somewhere else adds nothing to the size", async () => {
    const { repo, folder, scan } = branched();
    await mkdir(join(repo, "dir"));
    await writeFile(join(repo, "dir", "big.txt"), "x\n");
    git(repo, "add", "dir/big.txt");
    git(repo, "commit", "-q", "-m", "feat(x): dir");
    // The folder is now a link to a place outside the repository that holds a big file.
    const outside = tempDir("fd-teleport-outside-");
    await writeFile(join(outside, "big.txt"), "y".repeat(5000));
    await rm(join(repo, "dir"), { recursive: true });
    await symlink(outside, join(repo, "dir"));
    const outcome = await bundleCode({ cwd: repo, folder, id: "pkg-1", scan, maxBytes: 1000 }).then(
      () => "bundled",
      (error: { reason?: string }) => error.reason ?? String(error),
    );
    expect(outcome).toBe("bundled");
  });
});

describe("teleport-bundle: the code of a session as one git bundle (#100)", () => {
  test("the bundle holds the commits past origin and the working tree; the person's repo is as it was", async () => {
    const { repo, remote, folder } = await working();
    const before = state(repo);
    const code = await bundleCode({
      cwd: repo,
      folder,
      id: "pkg-1",
      scan: (text) => (text.includes("ghp_") ? ["GitHub token"] : []),
    });
    const after = state(repo);
    // The target: its own clone of origin, the bundle fetched into its own namespace.
    const target = join(tempDir("fd-teleport-target-"), "app");
    git(tempDir(), "clone", "-q", remote, target);
    const wip = "refs/flightdeck/teleport/in";
    /** What the target reads of the fetched bundle; a bundle it cannot fetch reads as "no bundle". */
    const fetched = (read: () => unknown) => {
      try {
        return read();
      } catch {
        return "no bundle";
      }
    };
    fetched(() => git(target, "fetch", "-q", code.file, `${code.ref}:${wip}`));
    expect([
      after,
      code.branch,
      code.base,
      code.head === before[3]?.trim(),
      code.ahead,
      code.changed,
      code.secrets,
      fetched(() => git(target, "rev-parse", `${wip}^`).trim() === code.head),
      fetched(() => git(target, "show", `${wip}:f1.txt`)),
      fetched(() => git(target, "show", `${wip}:new.txt`).includes(TOKEN)),
      fetched(() => git(target, "ls-tree", "--name-only", wip).includes("secret.env")),
      code.size ===
        (await readFile(code.file).then(
          (b) => b.byteLength,
          () => -1,
        )),
    ]).toEqual([
      before,
      "feature",
      "origin/main",
      true,
      3,
      2,
      { lines: 1, labels: ["GitHub token"] },
      true,
      "1 changed",
      true,
      false,
      true,
    ]);
  });

  test("a folder that is not a repository, or a repository with no origin, is refused", async () => {
    const plain = tempDir("fd-teleport-plain-");
    await mkdir(join(plain, "src"), { recursive: true });
    const { repo } = gitRepo();
    const folder = tempDir("fd-teleport-code-");
    const scan = () => [];
    expect([
      await reason(() => bundleCode({ cwd: plain, folder, id: "p", scan })),
      await reason(() => bundleCode({ cwd: repo, folder, id: "p", scan })),
    ]).toEqual(["teleport_no_git", "teleport_no_remote"]);
  });

  test("a bundle over the limit is refused, and no ref is left behind", async () => {
    const { repo, folder } = await working();
    const refused = await reason(() =>
      bundleCode({ cwd: repo, folder, id: "p", scan: () => [], maxBytes: 10 }),
    );
    expect([refused, git(repo, "for-each-ref", "refs/flightdeck")]).toEqual([
      "teleport_too_large",
      "",
    ]);
  });

  test("the repository's fsmonitor, external diff and gpg program never run", async () => {
    const { repo, folder } = await working();
    const marks = tempDir("fd-teleport-marks-");
    const script = async (name: string) => {
      const path = join(marks, `${name}.sh`);
      await writeFile(path, `#!/bin/sh\ntouch "${join(marks, name)}"\n`, { mode: 0o755 });
      return path;
    };
    git(repo, "config", "core.fsmonitor", await script("fsmonitor"));
    git(repo, "config", "diff.external", await script("external"));
    // A commit with a signature header makes `git log` run gpg.program when showSignature is on.
    git(repo, "config", "log.showSignature", "true");
    git(repo, "config", "gpg.program", await script("gpg"));
    const signed = git(repo, "cat-file", "commit", "HEAD").replace(
      /^(committer .*)$/m,
      "$1\ngpgsig -----BEGIN PGP SIGNATURE-----\n x\n -----END PGP SIGNATURE-----",
    );
    const object = join(marks, "commit.txt");
    await writeFile(object, signed);
    git(repo, "update-ref", "HEAD", git(repo, "hash-object", "-t", "commit", "-w", object).trim());
    await bundleCode({ cwd: repo, folder, id: "p", scan: () => [] });
    const ran = await readdir(marks);
    expect(ran.filter((name) => !name.includes("."))).toEqual([]);
  });

  test("a secret a commit added and a later one removed is still counted: the bundle carries both", async () => {
    const { repo, folder } = await working();
    await writeFile(join(repo, "old.txt"), `token ${TOKEN}\n`);
    git(repo, "add", "old.txt");
    git(repo, "commit", "-q", "-m", "feat(x): add");
    git(repo, "rm", "-q", "old.txt");
    git(repo, "commit", "-q", "-m", "fix(x): remove");
    await rm(join(repo, "new.txt"));
    const code = await bundleCode({
      cwd: repo,
      folder,
      id: "p",
      scan: (text) => (text.includes("ghp_") ? ["GitHub token"] : []),
    });
    expect(code.secrets).toEqual({ lines: 1, labels: ["GitHub token"] });
  });

  test("the bundle names its base by commit too: the target checks it has that commit", async () => {
    const { repo, folder } = await working();
    const code = await bundleCode({ cwd: repo, folder, id: "p", scan: () => [] });
    expect(code.baseSha).toBe(git(repo, "rev-parse", "origin/main").trim());
  });

  test("a working tree over the limit is refused before git writes anything into the repository", async () => {
    const { repo, folder } = await working();
    await writeFile(join(repo, "big.bin"), Buffer.alloc(4096, 1));
    const objects = () => git(repo, "count-objects").trim();
    const before = objects();
    const refused = await reason(() =>
      bundleCode({ cwd: repo, folder, id: "p", scan: () => [], maxBytes: 2048 }),
    );
    expect([refused, objects()]).toEqual(["teleport_too_large", before]);
  });

  test("a large file staged and not changed since is weighed too", async () => {
    const { repo, folder } = await working();
    await writeFile(join(repo, "staged.bin"), Buffer.alloc(4096, 1));
    git(repo, "add", "staged.bin");
    const objects = () => git(repo, "count-objects").trim();
    const before = objects();
    const refused = await reason(() =>
      bundleCode({ cwd: repo, folder, id: "p", scan: () => [], maxBytes: 2048 }),
    );
    expect([refused, objects()]).toEqual(["teleport_too_large", before]);
  });

  test("history whose text is past the limit is refused, never scanned in part", async () => {
    const { repo, folder } = await working();
    await writeFile(join(repo, "log.txt"), "a line that repeats\n".repeat(20_000));
    git(repo, "add", "log.txt");
    git(repo, "commit", "-q", "-m", "chore(x): a long file");
    const refused = await reason(() =>
      bundleCode({ cwd: repo, folder, id: "p", scan: () => [], maxBytes: 100_000 }),
    );
    expect(refused).toBe("teleport_too_large");
  });

  test("a file deleted from the working tree weighs nothing and still moves", async () => {
    const { repo, folder } = await working();
    await rm(join(repo, "f2.txt"));
    const changed = await bundleCode({ cwd: repo, folder, id: "p", scan: () => [] }).then(
      (code) => code.changed,
      (error: unknown) => String(error),
    );
    expect(changed).toBe(3);
  });

  test("a package id that is not a plain name never reaches git", async () => {
    const { repo, folder } = await working();
    expect([
      await reason(() => bundleCode({ cwd: repo, folder, id: "../x", scan: () => [] })),
      await reason(() => bundleCode({ cwd: repo, folder, id: "a".repeat(65), scan: () => [] })),
      git(repo, "for-each-ref", "refs/flightdeck"),
    ]).toEqual(["request_invalid", "request_invalid", ""]);
  });

  test("commits whose bundle is past the limit are refused, and the bundle file goes", async () => {
    const { repo, folder } = await working();
    await writeFile(join(repo, "noise.bin"), crypto.getRandomValues(new Uint8Array(4096)));
    git(repo, "add", "noise.bin");
    git(repo, "commit", "-q", "-m", "chore(x): noise");
    const refused = await reason(() =>
      bundleCode({ cwd: repo, folder, id: "p", scan: () => [], maxBytes: 2048 }),
    );
    expect([refused, await readdir(folder)]).toEqual(["teleport_too_large", []]);
  });

  test("a repository with no index yet still bundles its working tree", async () => {
    const { repo, folder } = await working();
    await rm(join(repo, ".git", "index"));
    const code = await bundleCode({ cwd: repo, folder, id: "p", scan: () => [] });
    expect([code.base, code.changed > 0]).toEqual(["origin/main", true]);
  });
});
