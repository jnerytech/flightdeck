import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { git, gitFailure, gitRepo, gitRepoWithOrigin } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";

const messageOf = (fn: () => unknown): string => {
  try {
    fn();
    return "(no error)";
  } catch (error) {
    return (error as Error).message;
  }
};

describe("git-helper: a git call that fails says why", () => {
  test("the exit code and what git wrote on stderr", () => {
    const message = messageOf(() => git(tempDir("fd-git-helper-"), "rev-parse", "HEAD"));
    expect(message).toContain("git rev-parse HEAD exited with code 128");
    expect(message).toContain("not a git repository");
  });

  test("what git wrote on stdout, where it reports nothing to commit", () => {
    const { repo } = gitRepo();
    const message = messageOf(() => git(repo, "commit", "-q", "-m", "vazio"));
    expect(message).toContain("exited with code 1");
    expect(message).toContain("nothing to commit");
  });

  test("a call ended by a signal says it was killed, not an empty error", () => {
    // What Bun.spawnSync returns when the test's own time limit kills the child it waits on.
    const killed = { exitCode: null, signalCode: "SIGTERM", stdout: "", stderr: "" };
    const message = gitFailure(["add", "."], killed);
    expect(message).toContain("git add . was killed by SIGTERM");
    expect(message).toContain("time limit");
    expect(message).not.toBe("git add .: ");
  });
});

describe("git-helper: the test repository", () => {
  const spies: Array<{ mockRestore(): void }> = [];
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  test("after the first one, a repository costs no git process", () => {
    gitRepo();
    const spawned = spyOn(Bun, "spawnSync");
    spies.push(spawned);
    gitRepo();
    gitRepo("outro");
    gitRepo();
    expect(spawned.mock.calls.length).toBe(0);
  });

  test("each one is its own repository: main, the initial commit, clean, autocrlf off", () => {
    const a = gitRepo();
    const b = gitRepo("outro");
    expect(basename(b.repo)).toBe("outro");
    expect(a.root).not.toBe(b.root);
    for (const { repo } of [a, b]) {
      expect(git(repo, "branch", "--show-current")).toBe("main");
      expect(git(repo, "log", "--format=%s")).toBe("inicial");
      expect(git(repo, "ls-files")).toBe(".gitignore\nREADME.md");
      expect(git(repo, "status", "--porcelain")).toBe("");
      expect(git(repo, "config", "--local", "core.autocrlf")).toBe("false");
      expect(git(repo, "config", "--local", "commit.gpgsign")).toBe("false");
    }
    writeFileSync(join(a.repo, "so-em-a.txt"), "a\n");
    git(a.repo, "add", "so-em-a.txt");
    git(a.repo, "commit", "-q", "-m", "só em a");
    expect(git(a.repo, "log", "--format=%s")).toBe("só em a\ninicial");
    expect(git(b.repo, "log", "--format=%s")).toBe("inicial");
    expect(git(b.repo, "status", "--porcelain")).toBe("");
  });
});

describe("git-helper: the test repository with an origin", () => {
  const spies: Array<{ mockRestore(): void }> = [];
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
  });

  test("after the first one, it costs one git process: its main is already on origin", () => {
    gitRepoWithOrigin();
    const spawned = spyOn(Bun, "spawnSync");
    spies.push(spawned);
    gitRepoWithOrigin();
    gitRepoWithOrigin();
    expect(spawned.mock.calls.length).toBe(2);
    spawned.mockRestore();
    const { repo, remote } = gitRepoWithOrigin();
    expect(git(repo, "remote", "get-url", "origin")).toBe(remote);
    expect(git(repo, "rev-parse", "origin/main")).toBe(git(repo, "rev-parse", "HEAD"));
    expect(git(remote, "log", "--format=%s", "main")).toBe("inicial");
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  test("each origin is its own: what one copy pushes reaches no other copy", () => {
    const a = gitRepoWithOrigin();
    const b = gitRepoWithOrigin();
    expect(a.remote).not.toBe(b.remote);
    writeFileSync(join(a.repo, "README.md"), "# repo\nmudou\n");
    git(a.repo, "commit", "-q", "-am", "só em a");
    git(a.repo, "push", "-q", "origin", "main");
    expect(git(a.remote, "log", "--format=%s", "main")).toBe("só em a\ninicial");
    expect(git(b.remote, "log", "--format=%s", "main")).toBe("inicial");
    expect(git(gitRepoWithOrigin().remote, "log", "--format=%s", "main")).toBe("inicial");
  });
});
