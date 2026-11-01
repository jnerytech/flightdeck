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

  test("resolve gives the same keys as keyFor: remote, worktree, plain folder, missing folder", async () => {
    const { repo } = gitRepo("r");
    git(repo, "remote", "add", "origin", "git@github.com:Acme/Repo.git");
    const worktree = join(tempDir(), "wt");
    git(repo, "worktree", "add", "-q", worktree, "-b", "wt");
    const plain = tempDir();
    const keys = new ProjectKeys("h1");
    expect(await keys.resolve(repo)).toBe("github.com/acme/repo");
    expect(await keys.resolve(worktree)).toBe("github.com/acme/repo");
    expect(await keys.resolve(plain)).toBe(`host:h1:${plain}`);
    const missing = join(plain, "nao-existe");
    expect(await keys.resolve(missing)).toBe(`host:h1:${missing}`);
    const noRemote = gitRepo("s").repo;
    expect(await keys.resolve(noRemote)).toBe(`host:h1:${noRemote}`);
  });

  test("while git is held the event loop keeps running and the key arrives when it is released", async () => {
    const gate = Promise.withResolvers<void>();
    const keys = new ProjectKeys(
      "h1",
      () => ({ code: 1, stdout: "" }),
      async () => {
        await gate.promise;
        return { code: 1, stdout: "" };
      },
    );
    const pending = keys.resolve("/w");
    let ticks = 0;
    const timer = setInterval(() => ticks++, 5);
    await Bun.sleep(60);
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(3);
    expect(await Promise.race([pending, Promise.resolve("held")])).toBe("held");
    gate.resolve();
    expect(await pending).toBe("host:h1:/w");
  });

  test("git runs once per cwd, for requests in flight and afterwards, and keyFor reads the same cache", async () => {
    const calls: string[][] = [];
    const sync: string[][] = [];
    const keys = new ProjectKeys(
      "h1",
      (args) => {
        sync.push(args);
        return { code: 1, stdout: "" };
      },
      async (args) => {
        calls.push(args);
        await Bun.sleep(5);
        return { code: 1, stdout: "" };
      },
    );
    const [a, b] = await Promise.all([keys.resolve("/w"), keys.resolve("/w")]);
    expect([a, b]).toEqual(["host:h1:/w", "host:h1:/w"]);
    expect(await keys.resolve("/w")).toBe("host:h1:/w");
    expect(keys.keyFor("/w")).toBe("host:h1:/w");
    expect(calls).toHaveLength(1);
    expect(sync).toEqual([]);
    expect(await keys.resolve("/other")).toBe("host:h1:/other");
    expect(calls).toHaveLength(2);
  });

  test("a git that cannot be started gives the folder key and is asked again next time", async () => {
    let calls = 0;
    const keys = new ProjectKeys(
      "h1",
      () => ({ code: 1, stdout: "" }),
      async () => {
        calls++;
        throw new Error("spawn git ENOENT");
      },
    );
    expect(await keys.resolve("/w")).toBe("host:h1:/w");
    expect(await keys.resolve("/w")).toBe("host:h1:/w");
    expect(calls).toBe(2);
  });

  test("lookup answers at once when the key is known and with a promise when it is not", async () => {
    const keys = new ProjectKeys(
      "h1",
      () => ({ code: 1, stdout: "" }),
      async () => ({ code: 1, stdout: "" }),
    );
    const cold = keys.lookup("/w");
    expect(typeof cold).toBe("object");
    expect(await cold).toBe("host:h1:/w");
    expect(keys.lookup("/w")).toBe("host:h1:/w");
  });
});
