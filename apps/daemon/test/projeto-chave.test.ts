import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeRemote, ProjectKeys } from "../src/central/project-key.ts";
import { git, gitRepo } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";

describe("projeto-chave", () => {
  test("SSH e HTTPS do mesmo remoto dão a mesma chave, sem .git e em minúsculas", async () => {
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

  test("dois clones do mesmo repositório, um por SSH e outro por HTTPS, caem no mesmo grupo", async () => {
    const a = gitRepo("a").repo;
    const b = gitRepo("b").repo;
    git(a, "remote", "add", "origin", "git@github.com:Acme/Repo.git");
    git(b, "remote", "add", "origin", "https://github.com/acme/repo");
    const keys = new ProjectKeys("h1");
    expect(await keys.resolve(a)).toBe("github.com/acme/repo");
    expect(await keys.resolve(b)).toBe("github.com/acme/repo");
  });

  test("worktree cai no repositório principal, com e sem remoto", async () => {
    const { repo } = gitRepo();
    const worktree = join(repo, ".flightdeck", "worktrees", "x");
    git(repo, "worktree", "add", "-q", worktree, "-b", "fd/x");
    const keys = new ProjectKeys("h1");
    expect(await keys.resolve(worktree)).toBe(`host:h1:${repo}`);
    const other = gitRepo().repo;
    git(other, "remote", "add", "origin", "https://github.com/acme/outro.git");
    const tree = join(other, ".flightdeck", "worktrees", "y");
    git(other, "worktree", "add", "-q", tree, "-b", "fd/y");
    expect(await keys.resolve(tree)).toBe("github.com/acme/outro");
  });

  test("sem remoto, a raiz do repositório; sem repositório, o próprio cwd", async () => {
    const { repo } = gitRepo();
    const sub = join(repo, "src", "lib");
    mkdirSync(sub, { recursive: true });
    const keys = new ProjectKeys("h1");
    expect(await keys.resolve(sub)).toBe(`host:h1:${repo}`);
    const plain = tempDir();
    expect(await keys.resolve(plain)).toBe(`host:h1:${plain}`);
    expect(await keys.resolve(join(plain, "nao-existe"))).toBe(
      `host:h1:${join(plain, "nao-existe")}`,
    );
  });

  test("a chave fica em cache por cwd", async () => {
    const { repo } = gitRepo();
    const calls: string[][] = [];
    const keys = new ProjectKeys("h1", async (args) => {
      calls.push(args);
      return { code: 1, stdout: "" };
    });
    expect(await keys.resolve(repo)).toBe(`host:h1:${repo}`);
    expect(await keys.resolve(repo)).toBe(`host:h1:${repo}`);
    expect(calls).toHaveLength(1);
  });

  test("resolve gives the keys of remote, worktree, plain folder, missing folder", async () => {
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
    const keys = new ProjectKeys("h1", async () => {
      await gate.promise;
      return { code: 1, stdout: "" };
    });
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

  test("git runs once per cwd, for requests in flight and afterwards, and `known` reads the same cache", async () => {
    const calls: string[][] = [];
    const keys = new ProjectKeys("h1", async (args) => {
      calls.push(args);
      await Bun.sleep(5);
      return { code: 1, stdout: "" };
    });
    const [a, b] = await Promise.all([keys.resolve("/w"), keys.resolve("/w")]);
    expect([a, b]).toEqual(["host:h1:/w", "host:h1:/w"]);
    expect(await keys.resolve("/w")).toBe("host:h1:/w");
    expect(keys.known("/w")).toBe("host:h1:/w");
    expect(calls).toHaveLength(1);
    expect(await keys.resolve("/other")).toBe("host:h1:/other");
    expect(calls).toHaveLength(2);
  });

  test("a git that cannot be started gives the folder key and is asked again next time", async () => {
    let calls = 0;
    const keys = new ProjectKeys("h1", async () => {
      calls++;
      throw new Error("spawn git ENOENT");
    });
    expect(await keys.resolve("/w")).toBe("host:h1:/w");
    expect(await keys.resolve("/w")).toBe("host:h1:/w");
    expect(calls).toBe(2);
  });

  test("lookup answers at once when the key is known and with a promise when it is not", async () => {
    const keys = new ProjectKeys("h1", async () => ({ code: 1, stdout: "" }));
    const cold = keys.lookup("/w");
    expect(typeof cold).toBe("object");
    expect(await cold).toBe("host:h1:/w");
    expect(keys.lookup("/w")).toBe("host:h1:/w");
  });

  test("a folder that becomes a git repository later gets its repository's key, not the folder key it had", async () => {
    const root = tempDir("fd-chave-pasta-");
    const folder = join(root, "app");
    mkdirSync(folder);
    const keys = new ProjectKeys("h1");
    expect(await keys.resolve(folder)).toBe(`host:h1:${folder}`);
    expect(await keys.resolve(folder)).toBe(`host:h1:${folder}`);
    git(folder, "init", "-q", "-b", "main");
    git(folder, "remote", "add", "origin", "git@github.com:Acme/App.git");
    expect(await keys.resolve(folder)).toBe("github.com/acme/app");
    expect(await keys.resolve(folder)).toBe("github.com/acme/app");
    expect(keys.lookup(folder)).toBe("github.com/acme/app");
  });

  test("a folder that stays without a repository keeps its cached key and git is not asked again", async () => {
    const folder = tempDir("fd-chave-pasta-");
    const calls: string[][] = [];
    const keys = new ProjectKeys("h1", async (args) => {
      calls.push(args);
      return { code: 128, stdout: "" };
    });
    await keys.resolve(folder);
    await keys.resolve(folder);
    await keys.resolve(folder);
    expect(calls).toHaveLength(1);
  });

  test("known answers at once: the cached key, else the folder key while one git lookup runs in the background", async () => {
    const calls: string[][] = [];
    const gate = Promise.withResolvers<void>();
    const keys = new ProjectKeys("h1", async (args) => {
      calls.push(args);
      await gate.promise;
      return {
        code: 0,
        stdout: args.includes("--git-common-dir") ? "/r/.git\n" : "git@github.com:Acme/R.git\n",
      };
    });
    expect(keys.known("/r/sub")).toBe("host:h1:/r/sub");
    expect(keys.known("/r/sub")).toBe("host:h1:/r/sub");
    const asked = calls.length;
    gate.resolve();
    expect(await keys.resolve("/r/sub")).toBe("github.com/acme/r");
    expect(keys.known("/r/sub")).toBe("github.com/acme/r");
    // One lookup (two git calls) served both cold answers and the resolve.
    expect(asked).toBe(1);
    expect(calls).toHaveLength(2);
  });

  test("known on a folder cached without a repository asks git nothing while its .git state is the same", async () => {
    const folder = tempDir("fd-chave-known-");
    const calls: string[][] = [];
    const keys = new ProjectKeys("h1", async (args) => {
      calls.push(args);
      return { code: 128, stdout: "" };
    });
    await keys.resolve(folder);
    expect(keys.known(folder)).toBe(`host:h1:${folder}`);
    await keys.resolve(folder);
    expect(calls).toHaveLength(1);
  });
});
