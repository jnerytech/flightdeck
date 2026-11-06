import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
      "1 changed\n",
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
});
