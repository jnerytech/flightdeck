import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as protocol from "@flightdeck/protocol";
import { FlightdeckError } from "../src/errors.ts";
import { cloneRepo, type GitRunner, scanRepos } from "../src/project-find.ts";
import { type RunningServer, startServer } from "../src/server.ts";
import { newManager, poll, tempDir } from "./helpers.ts";

/** A root with repos at several depths, plus things a scan must not enter or follow. */
function tree() {
  const base = realpathSync(tempDir("fd-find-"));
  const root = join(base, "code");
  for (const dir of [
    "app/.git",
    "group/lib/.git",
    "group/deep/er/too/.git",
    "plain/notes",
    "node_modules/pkg/.git",
    ".hidden/repo/.git",
    "app/packages/inner/.git",
  ]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  // A worktree keeps `.git` as a file.
  mkdirSync(join(root, "wt"));
  writeFileSync(join(root, "wt", ".git"), "gitdir: /elsewhere");
  const outside = join(base, "outside");
  mkdirSync(join(outside, "stolen/.git"), { recursive: true });
  symlinkSync(join(outside, "stolen"), join(root, "link"));
  return { base, root, outside };
}

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

/** A git that creates the folder it was asked to clone into, and remembers its arguments. */
function fakeGit(code = 0, stderr = "") {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push(args);
    if (code === 0) mkdirSync(args[args.length - 1] as string, { recursive: true });
    return { code, stderr };
  };
  return { git, calls };
}

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

const TOKEN = "projects-find-token-0123456789";
const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

async function ask(server: RunningServer, type: string, payload: object) {
  const ws = new WebSocket(server.url);
  const acks: protocol.Ack[] = [];
  ws.addEventListener("message", (m) => {
    const msg = protocol.parseServerMessage(String(m.data));
    if (msg.type === "ack") acks.push(msg);
  });
  await new Promise((r) => ws.addEventListener("open", r));
  ws.send(JSON.stringify({ id: "1", type: "hello", payload: { token: TOKEN, client: "t" } }));
  ws.send(JSON.stringify({ id: "2", type, payload }));
  const ack = await poll(() => acks.find((a) => a.id === "2"), 2000);
  ws.close();
  return ack;
}

function server(root: string, extra: Partial<Parameters<typeof startServer>[0]> = {}) {
  const started = startServer({
    manager: newManager().manager,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [root],
    ...extra,
  });
  stops.push(() => started.stop());
  return started;
}

describe("projetos-busca: the commands", () => {
  test("payloads: scan takes a bounded depth, clone takes a URL, a root and a name", () => {
    const parse = (type: string, payload: object) =>
      protocol.Command.safeParse({ id: "1", type, payload }).success;
    expect(parse("projects.scan", {})).toBe(true);
    expect(parse("projects.scan", { depth: 3 })).toBe(true);
    expect(parse("projects.scan", { depth: 4 })).toBe(false);
    expect(parse("projects.clone", { url: "https://a/b.git", root: "/r", name: "n" })).toBe(true);
    expect(parse("projects.clone", { url: "", root: "/r" })).toBe(false);
    expect(parse("projects.clone", { url: "https://a/b.git" })).toBe(false);
  });

  test("scan and clone answer for the allowed roots; host.info announces them", async () => {
    const { root } = tree();
    const { git, calls } = fakeGit();
    const running = server(root, { findProjects: true, git });
    const scan = await ask(running, "projects.scan", {});
    expect(scan?.ok && (scan.data as protocol.ProjectsScanResult).repos).toHaveLength(3);
    const url = "https://example.com/acme/new.git";
    const clone = await ask(running, "projects.clone", { url, root });
    expect(clone?.ok && clone.data).toEqual({ path: join(root, "new") });
    expect(calls).toHaveLength(1);
    const refused = await ask(running, "projects.clone", { url: "file:///x", root });
    expect(refused && !refused.ok && refused.error.reason).toBe("clone_url_scheme");
    const info = await ask(running, "host.info", {});
    expect(info?.ok && (info.data as { features: string[] }).features).toEqual(
      expect.arrayContaining(["projects.scan", "projects.clone"]),
    );
  });

  test("a daemon without the feature refuses both and announces nothing", async () => {
    const { root } = tree();
    const bare = server(root);
    const scan = await ask(bare, "projects.scan", {});
    expect(scan && !scan.ok && scan.error.reason).toBe("feature_off");
    const clone = await ask(bare, "projects.clone", { url: "https://a/b.git", root });
    expect(clone && !clone.ok && clone.error.reason).toBe("feature_off");
    const info = await ask(bare, "host.info", {});
    expect(info?.ok && (info.data as { features: string[] }).features).toEqual([]);
  });
});
