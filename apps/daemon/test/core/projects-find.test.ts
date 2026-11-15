import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { FlightdeckError } from "../../src/kernel/errors.ts";
import { gitRunner } from "../../src/projects/adapters/git-clone.ts";
import { cloneRepo, scanRepos } from "../../src/projects/project-find.ts";
import { reasonOf, tempDir } from "../support/helpers.ts";
import { fakeGit, tree } from "../support/projects-find.ts";

const names = (result: { repos: Array<{ name: string }> }) => result.repos.map((r) => r.name);

describe("projetos-busca: scanning the allowed roots", () => {
  test("finds repositories to two levels by default, without entering repos, hidden folders or node_modules", async () => {
    const { root } = tree();
    const result = await scanRepos([root]);
    expect(names(result)).toEqual(["app", "lib", "wt"]);
    expect(result.repos.map((r) => r.path)).toEqual([
      join(root, "app"),
      join(root, "group", "lib"),
      join(root, "wt"),
    ]);
    expect(result.repos.every((r) => r.root === root)).toBe(true);
    expect(result.truncated).toBe(false);
  });

  test("the depth bounds how far it looks", async () => {
    const { root } = tree();
    expect(names(await scanRepos([root], { depth: 1 }))).toEqual(["app", "wt"]);
    expect(names(await scanRepos([root], { depth: 4 }))).toEqual(["app", "too", "lib", "wt"]);
  });

  test("a link out of the roots is not followed, and a root that is a repo is found itself", async () => {
    const { root, outside } = tree();
    const found = await scanRepos([root]);
    expect(found.repos.some((r) => r.path.startsWith(outside))).toBe(false);
    expect(found.repos.some((r) => r.name === "stolen")).toBe(false);
    const own = await scanRepos([join(root, "app")]);
    expect(names(own)).toEqual(["app"]);
  });

  test("stops at the cap and says so; a root that is gone or listed twice does no harm", async () => {
    const { root } = tree();
    const capped = await scanRepos([root], { cap: 2 });
    expect(capped.repos).toHaveLength(2);
    expect(capped.truncated).toBe(true);
    const twice = await scanRepos([root, root, join(root, "missing")]);
    expect(names(twice)).toEqual(["app", "lib", "wt"]);
  });
});

const refusal = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(FlightdeckError);
  return error as FlightdeckError;
};

describe("projetos-busca: cloning into a root", () => {
  test("clones into root/<name from the URL> with git clone -- <url> <dest>", async () => {
    const { root } = tree();
    const { git, calls } = fakeGit();
    const url = "https://github.com/acme/widget.git";
    const result = await cloneRepo({ url, root }, [root], git);
    expect(result.path).toBe(join(root, "widget"));
    expect(calls).toEqual([["clone", "--", url, join(root, "widget")]]);
    const named = await cloneRepo({ url, root, name: "custom" }, [root], git);
    expect(named.path).toBe(join(root, "custom"));
    const scp = await cloneRepo({ url: "git@github.com:acme/other.git", root }, [root], git);
    expect(scp.path).toBe(join(root, "other"));
  });

  test("refuses a URL that could be an option or a helper, with the reason", async () => {
    const { root } = tree();
    const { git, calls } = fakeGit();
    const bad: Array<[string, string]> = [
      ["--upload-pack=touch /tmp/x", "clone_url_invalid"],
      ["https://example.com/a b.git", "clone_url_invalid"],
      ["https://example.com/a.git\nfoo", "clone_url_invalid"],
      ["file:///etc", "clone_url_scheme"],
      ["ext::sh -c touch% /tmp/x", "clone_url_scheme"],
      ["/home/someone/repo", "clone_url_scheme"],
      ["http://example.com/a.git", "clone_url_scheme"],
    ];
    for (const [url, reason] of bad) {
      const error = await refusal(cloneRepo({ url, root }, [root], git));
      expect([url, error.reason]).toEqual([url, reason]);
    }
    expect(calls).toEqual([]);
  });

  test("refuses a name that is a path, a hidden folder or empty", async () => {
    const { root } = tree();
    const { git } = fakeGit();
    const url = "https://example.com/a/b.git";
    for (const name of ["../x", "a/b", ".hidden", "a b"]) {
      const error = await refusal(cloneRepo({ url, root, name }, [root], git));
      expect([name, error.reason]).toEqual([name, "clone_name_invalid"]);
    }
    const bare = await refusal(cloneRepo({ url: "https://example.com/", root }, [root], git));
    expect(bare.reason).toBe("clone_name_invalid");
  });

  test("refuses a root outside the allowed ones, and a folder that already exists", async () => {
    const { root, outside } = tree();
    const { git, calls } = fakeGit();
    const url = "https://example.com/acme/app.git";
    const out = await refusal(cloneRepo({ url, root: outside }, [root], git));
    expect(out.code).toBe("forbidden_cwd");
    expect(out.reason).toBe("cwd_outside_roots");
    const taken = await refusal(cloneRepo({ url, root }, [root], git));
    expect(taken.reason).toBe("clone_exists");
    expect(taken.params).toEqual({ path: join(root, "app") });
    expect(calls).toEqual([]);
  });

  test("a failing git says why, with the last line it printed", async () => {
    const { root } = tree();
    const { git } = fakeGit(
      128,
      "Cloning into 'x'...\nfatal: repository 'https://example.com/n.git' not found\n",
    );
    const error = await refusal(cloneRepo({ url: "https://example.com/n.git", root }, [root], git));
    expect(error.reason).toBe("clone_failed");
    expect(error.params?.detail).toBe("fatal: repository 'https://example.com/n.git' not found");
    expect(existsSync(join(root, "n"))).toBe(false);
  });
});

describe("projetos-busca: odd inputs and the real git runner", () => {
  test("an address that names nothing is a bad folder name", async () => {
    const roots = [tempDir("fd-clone-")];
    const git = async () => ({ code: 0, stderr: "" });
    expect(
      await reasonOf(cloneRepo({ url: "https://", root: roots[0] as string }, roots, git)),
    ).toBe("clone_name_invalid");
  });

  test("the real git runner answers its exit code and stderr, and stops a git that never ends", async () => {
    const run = gitRunner(5_000);
    expect(await run(["--version"])).toMatchObject({ code: 0 });
    const failed = await run([
      "clone",
      "--",
      join(tempDir(), "no-such-repo"),
      join(tempDir(), "dest"),
    ]);
    expect(failed.code).not.toBe(0);
    // A git command that really runs for seconds on every OS: an alias that starts this Bun (git
    // runs `!` aliases with its own sh, also on Windows, which has no `sleep` on the path).
    const bun = process.execPath.replaceAll("\\", "/");
    const impatient = gitRunner(300);
    const started = Date.now();
    const slow = await impatient([
      "-c",
      `alias.slow=!"${bun}" -e "setTimeout(() => {}, 5000)"`,
      "slow",
    ]);
    const took = Date.now() - started;
    expect(slow.code).not.toBe(0);
    // It waited for the timer (a git that failed at once would be back sooner) and was stopped well
    // before the five seconds were up.
    expect(took).toBeGreaterThanOrEqual(250);
    expect(took).toBeLessThan(4_000);
  }, 30_000);

  test("a scan skips a folder it cannot read and still finds the others", async () => {
    const root = tempDir("fd-scan-");
    for (const name of ["a/.git", "locked/inner/.git", "b/.git"])
      mkdirSync(join(root, name), { recursive: true });
    // A listing that fails for one folder, on every OS (chmod 000 does nothing on Windows).
    const failing = (async (dir: Parameters<typeof readdir>[0], ...rest: unknown[]) => {
      if (String(dir).endsWith("locked"))
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      return (readdir as (...args: unknown[]) => Promise<unknown>)(dir, ...rest);
    }) as typeof readdir;
    const found = await scanRepos([root], { readdir: failing });
    expect(found.repos.map((r) => r.name).sort()).toEqual(["a", "b"]);
  });

  test("a scan stops after opening 2000 folders and says it was cut short", async () => {
    const root = tempDir("fd-scan-many-");
    for (let i = 0; i < 2_100; i += 1) mkdirSync(join(root, `d${i}`));
    const found = await scanRepos([root]);
    expect(found.truncated).toBe(true);
  }, 30_000);
});
