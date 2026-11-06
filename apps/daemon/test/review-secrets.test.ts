import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { cardDiff, workingDiff } from "../src/board/diff.ts";
import { refArg } from "../src/board/ref-arg.ts";
import { Changes } from "../src/review/changes.ts";
import { ReviewFiles } from "../src/review/files.ts";
import { git, gitRepo } from "./board-helpers.ts";
import { newManager, tempDir } from "./helpers.ts";
import { insertSession } from "./usage-helpers.ts";

// Real git in temporary repositories: more than the default 5 s.
setDefaultTimeout(20_000);

/** A repository in the allowed root, a session `s-1` on it, `a.txt` and `.env.example` committed. */
function setup() {
  const ctx = newManager();
  const repo = ctx.project;
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "config", "core.autocrlf", "false");
  writeFileSync(join(repo, "a.txt"), "one\n");
  writeFileSync(join(repo, ".env.example"), "TOKEN=committed\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "first");
  insertSession(ctx.store.db, "m-1", "s-1", repo);
  const files = new ReviewFiles({
    changes: new Changes({ db: ctx.store.db }),
    dataDir: tempDir("fd-data-"),
    allowedRoots: [ctx.root],
  });
  return { ...ctx, repo, files };
}

/** The code and reason a call is refused with, or `ok` when it is not refused. */
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

describe("review-secrets: file.read stays in the repository (#509)", () => {
  test("a link inside the repository that points out of it is not read", async () => {
    const { repo, files } = setup();
    const outside = tempDir("fd-outside-");
    writeFileSync(join(outside, "notes.txt"), "outside\n");
    await linkDir(outside, join(repo, "link"));
    expect(await outcome(files.read("session:s-1", "link/notes.txt"))).toEqual({
      code: "forbidden_cwd",
      reason: "review_path_link",
    });
  });

  test("a link that stays inside the repository is read as before", async () => {
    const { repo, files } = setup();
    mkdirSync(join(repo, "docs"));
    writeFileSync(join(repo, "docs", "guide.md"), "# guide\n");
    await linkDir(join(repo, "docs"), join(repo, "manual"));
    expect((await files.read("session:s-1", "manual/guide.md")).text).toBe("# guide\n");
  });
});

describe("review-secrets: a credential file is neither shown nor changed (#509)", () => {
  test("file.read refuses every kind of credential path with its own reason", async () => {
    const { repo, files } = setup();
    mkdirSync(join(repo, ".aws"));
    mkdirSync(join(repo, "keys"));
    const paths = [".env", ".env.local", "keys/id_ed25519", ".npmrc", "cert.pem", ".aws/config"];
    for (const path of paths) writeFileSync(join(repo, path), "SECRET=1\n");
    for (const path of [...paths, ".env.example"]) {
      expect({ path, ...(await outcome(files.read("session:s-1", path))) }).toEqual({
        path,
        code: "bad_request",
        reason: "review_file_secret",
      });
    }
    expect((await files.read("session:s-1", "a.txt")).text).toBe("one\n");
  });

  test("a harmless name that leads into a credential folder is refused too", async () => {
    const { repo, files } = setup();
    mkdirSync(join(repo, ".aws"));
    writeFileSync(join(repo, ".aws", "settings.txt"), "SECRET=1\n");
    await linkDir(join(repo, ".aws"), join(repo, "conf"));
    expect(await outcome(files.read("session:s-1", "conf/settings.txt"))).toEqual({
      code: "bad_request",
      reason: "review_file_secret",
    });
  });

  test("file.write refuses a credential file and leaves it as it was", async () => {
    const { repo, files } = setup();
    expect(await outcome(files.write("session:s-1", ".env.example", "TOKEN=new\n", ""))).toEqual({
      code: "bad_request",
      reason: "review_file_secret",
    });
    expect(await Bun.file(join(repo, ".env.example")).text()).toBe("TOKEN=committed\n");
  });
});

describe("review-secrets: the diff lists a credential file without its content (#509)", () => {
  test("new, changed and renamed credential files carry the mark and no lines", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, ".env.local"), "TOKEN=new-file\n");
    writeFileSync(join(repo, "id_rsa"), "PRIVATE\n");
    writeFileSync(join(repo, "notes.txt"), "plain\n");
    const files = await workingDiff(repo);
    for (const path of [".env.local", "id_rsa"]) {
      expect(files.find((f) => f.path === path)).toMatchObject({
        status: "added",
        secret: true,
        additions: 0,
        deletions: 0,
        hunks: [],
      });
    }
    expect(files.find((f) => f.path === "notes.txt")?.secret).toBeUndefined();
    expect(files.find((f) => f.path === "notes.txt")?.hunks.length).toBe(1);
    expect(JSON.stringify(files)).not.toContain("TOKEN=new-file");
    expect(JSON.stringify(files)).not.toContain("PRIVATE");
  });

  test("a tracked credential file that changed, or was renamed from one, shows no lines", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, ".env.example"), "TOKEN=old\n");
    // Ten lines, so one changed line still leaves git calling the move a rename.
    const key = (second: string) =>
      ["KEY=old", second, ...Array.from({ length: 8 }, (_, i) => `line ${i + 3}`)].join("\n");
    writeFileSync(join(repo, "server.key"), `${key("line 2")}\n`);
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "secrets");
    writeFileSync(join(repo, ".env.example"), "TOKEN=changed\n");
    git(repo, "mv", "server.key", "server.txt");
    writeFileSync(join(repo, "server.txt"), `${key("line two")}\n`);
    git(repo, "add", "server.txt");
    const files = await workingDiff(repo);
    expect(files.find((f) => f.path === ".env.example")).toMatchObject({
      status: "modified",
      secret: true,
      hunks: [],
    });
    expect(files.find((f) => f.path === "server.txt")).toMatchObject({
      status: "renamed",
      oldPath: "server.key",
      secret: true,
      hunks: [],
    });
    expect(JSON.stringify(files)).not.toContain("TOKEN=");
    expect(JSON.stringify(files)).not.toContain("KEY=");
  });

  test("a card's committed credential file shows no lines either", async () => {
    const { repo } = gitRepo();
    git(repo, "checkout", "-q", "-b", "card");
    writeFileSync(join(repo, ".npmrc"), "//registry/:_authToken=abc\n");
    writeFileSync(join(repo, "readme-2.md"), "plain\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "card work");
    renameSync(join(repo, "readme-2.md"), join(repo, "readme-3.md"));
    const { files } = await cardDiff(repo, refArg("main"));
    expect(files.find((f) => f.path === ".npmrc")).toMatchObject({ secret: true, hunks: [] });
    expect(files.find((f) => f.path === "readme-2.md")?.hunks.length).toBe(1);
    expect(JSON.stringify(files)).not.toContain("_authToken");
  });
});
