import { describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

  test("a repository with no index yet still bundles its working tree", async () => {
    const { repo, folder } = await working();
    await rm(join(repo, ".git", "index"));
    const code = await bundleCode({ cwd: repo, folder, id: "p", scan: () => [] });
    expect([code.base, code.changed > 0]).toEqual(["origin/main", true]);
  });
});
