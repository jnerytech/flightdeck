import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { Changes } from "../src/review/changes.ts";
import { ReviewFiles } from "../src/review/files.ts";
import { startServer } from "../src/server.ts";
import { git } from "./board-helpers.ts";
import { newManager, tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";
import { insertSession } from "./usage-helpers.ts";

// Real git in temporary repositories: more than the default 5 s.
setDefaultTimeout(20_000);

const TOKEN = "file-list-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A repository in the allowed root with a session `s-1` on it. */
function setup() {
  const ctx = newManager();
  const repo = ctx.project;
  git(repo, "init", "-q", "-b", "main");
  insertSession(ctx.store.db, "m-1", "s-1", repo);
  const files = new ReviewFiles({
    changes: new Changes({ db: ctx.store.db }),
    dataDir: tempDir("fd-data-"),
    allowedRoots: [ctx.root],
  });
  return { ...ctx, repo, files };
}

const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => ({ code: "ok", reason: null }),
    (error: { code?: string; reason?: string }) => ({
      code: error.code ?? "",
      reason: error.reason ?? null,
    }),
  );

/** A folder link: a junction on Windows, which needs no privilege; a plain link elsewhere. */
const linkDir = (target: string, path: string) => symlink(target, path, "junction");

/** The entries as `kind name` lines, with `!` after a secret one. */
const lines = (entries: Array<{ name: string; kind: string; secret?: boolean }>) =>
  entries.map((e) => `${e.kind} ${e.name}${e.secret ? " !" : ""}`);

describe("file-list: one folder of the session's repository, for the file explorer (#506)", () => {
  test("folders first, then files, in natural order; .git never; dot files shown, credentials marked", async () => {
    const { repo, files } = setup();
    for (const dir of ["src", ".github", "docs"]) mkdirSync(join(repo, dir));
    for (const name of ["file10.txt", "file2.txt", "B.md", "a.md", ".env", ".gitignore"]) {
      writeFileSync(join(repo, name), "x\n");
    }
    const listed = await files.list("session:s-1", "");
    expect(listed.dir).toBe("");
    expect(listed.truncated).toBe(false);
    expect(lines(listed.entries)).toEqual([
      "dir .github",
      "dir docs",
      "dir src",
      "file .env !",
      "file .gitignore",
      "file a.md",
      "file B.md",
      "file file2.txt",
      "file file10.txt",
    ]);
  });

  test("a subfolder lists its own entries, with the credential folder's files marked", async () => {
    const { repo, files } = setup();
    mkdirSync(join(repo, "src", "lib"), { recursive: true });
    writeFileSync(join(repo, "src", "main.ts"), "x\n");
    mkdirSync(join(repo, ".aws"));
    writeFileSync(join(repo, ".aws", "config"), "x\n");
    expect(lines((await files.list("session:s-1", "src")).entries)).toEqual([
      "dir lib",
      "file main.ts",
    ]);
    expect(lines((await files.list("session:s-1", ".aws")).entries)).toEqual(["file config !"]);
  });

  test("outside the repository, inside .git, a file or a missing folder: refused with a reason", async () => {
    const { repo, files } = setup();
    writeFileSync(join(repo, "a.txt"), "x\n");
    for (const dir of ["../x", "/etc", ".git", ".git/hooks"]) {
      expect({ dir, ...(await outcome(files.list("session:s-1", dir))) }).toEqual({
        dir,
        code: "bad_request",
        reason: "review_path_outside",
      });
    }
    for (const dir of ["a.txt", "gone"]) {
      expect({ dir, ...(await outcome(files.list("session:s-1", dir))) }).toEqual({
        dir,
        code: "not_found",
        reason: "review_file_missing",
      });
    }
  });

  test("a link out of the repository is neither listed nor opened; one inside is, as what it points at", async () => {
    const { repo, files } = setup();
    const outside = tempDir("fd-outside-");
    writeFileSync(join(outside, "notes.txt"), "x\n");
    await linkDir(outside, join(repo, "away"));
    mkdirSync(join(repo, ".ssh"));
    await linkDir(join(repo, ".ssh"), join(repo, "keys"));
    mkdirSync(join(repo, "docs"));
    await linkDir(join(repo, "docs"), join(repo, "manual"));
    expect(lines((await files.list("session:s-1", "")).entries)).toEqual([
      "dir .ssh !",
      "dir docs",
      "dir keys !",
      "dir manual",
    ]);
    expect(await outcome(files.list("session:s-1", "away"))).toEqual({
      code: "forbidden_cwd",
      reason: "review_path_link",
    });
  });

  test("a folder with more entries than the cap lists the first ones and says it was cut", async () => {
    const { repo, files } = setup();
    mkdirSync(join(repo, "many"));
    for (let i = 0; i < 501; i++) writeFileSync(join(repo, "many", `f${i}.txt`), "");
    const listed = await files.list("session:s-1", "many");
    expect([listed.entries.length, listed.truncated]).toEqual([500, true]);
  });

  test("the host announces file.list and answers it over the protocol", async () => {
    const ctx = setup();
    writeFileSync(join(ctx.repo, "a.txt"), "x\n");
    const server = startServer({
      manager: ctx.manager,
      files: ctx.files,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [ctx.root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const info = await client.data<{ features?: string[] }>("host.info", {});
    expect(info?.features ?? []).toContain("file.list");
    const listed = await client.data<{ entries: Array<{ name: string }> }>("file.list", {
      target: "session:s-1",
      dir: "",
    });
    expect(listed?.entries.map((e) => e.name)).toEqual(["a.txt"]);
  });
});
