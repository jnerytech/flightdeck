import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeRemote, ProjectKeys } from "../src/central/project-key.ts";
import { git, gitRepo } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";

describe("projeto-chave", () => {
  test("SSH e HTTPS do mesmo remoto dão a mesma chave, sem .git e em minúsculas", () => {
    for (const url of [
      "git@github.com:Acme/Repo.git",
      "https://github.com/acme/repo.git",
      "https://github.com/Acme/Repo",
      "ssh://git@github.com/acme/repo.git",
      "ssh://git@github.com:22/Acme/Repo.git",
      "https://user:token@github.com/acme/repo.git/",
    ]) {
      expect(normalizeRemote(url)).toBe("github.com/acme/repo");
    }
    expect(normalizeRemote("https://dev.azure.com/Org/Proj/_git/Repo")).toBe(
      "dev.azure.com/org/proj/_git/repo",
    );
  });

  test("dois clones do mesmo repositório, um por SSH e outro por HTTPS, caem no mesmo grupo", () => {
    const a = gitRepo("a").repo;
    const b = gitRepo("b").repo;
    git(a, "remote", "add", "origin", "git@github.com:Acme/Repo.git");
    git(b, "remote", "add", "origin", "https://github.com/acme/repo");
    const keys = new ProjectKeys("h1");
    expect(keys.keyFor(a)).toBe("github.com/acme/repo");
    expect(keys.keyFor(b)).toBe("github.com/acme/repo");
  });

  test("worktree cai no repositório principal, com e sem remoto", () => {
    const { repo } = gitRepo();
    const worktree = join(repo, ".flightdeck", "worktrees", "x");
    git(repo, "worktree", "add", "-q", worktree, "-b", "fd/x");
    const keys = new ProjectKeys("h1");
    expect(keys.keyFor(worktree)).toBe(`host:h1:${repo}`);
    const other = gitRepo().repo;
    git(other, "remote", "add", "origin", "https://github.com/acme/outro.git");
    const tree = join(other, ".flightdeck", "worktrees", "y");
    git(other, "worktree", "add", "-q", tree, "-b", "fd/y");
    expect(keys.keyFor(tree)).toBe("github.com/acme/outro");
  });

  test("sem remoto, a raiz do repositório; sem repositório, o próprio cwd", () => {
    const { repo } = gitRepo();
    const sub = join(repo, "src", "lib");
    mkdirSync(sub, { recursive: true });
    const keys = new ProjectKeys("h1");
    expect(keys.keyFor(sub)).toBe(`host:h1:${repo}`);
    const plain = tempDir();
    expect(keys.keyFor(plain)).toBe(`host:h1:${plain}`);
    expect(keys.keyFor(join(plain, "nao-existe"))).toBe(`host:h1:${join(plain, "nao-existe")}`);
  });

  test("a chave fica em cache por cwd", () => {
    const { repo } = gitRepo();
    const calls: string[][] = [];
    const keys = new ProjectKeys("h1", (args) => {
      calls.push(args);
      return { code: 1, stdout: "" };
    });
    expect(keys.keyFor(repo)).toBe(`host:h1:${repo}`);
    expect(keys.keyFor(repo)).toBe(`host:h1:${repo}`);
    expect(calls).toHaveLength(1);
  });
});
