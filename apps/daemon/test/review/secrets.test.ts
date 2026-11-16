import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../support/helpers.ts";
import { linkDir, outcome, setup } from "./secrets-setup.ts";

// Real git in temporary repositories: more than the default 5 s.
setDefaultTimeout(20_000);

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

describe("review-secrets: a review comment never quotes a credential file or a file out of the repo (#509)", () => {
  const comment = (over: Record<string, unknown>) => ({
    target: "session:s-1",
    path: "a.txt",
    side: "new" as const,
    lineStart: 1,
    lineEnd: 1,
    body: "look",
    ...over,
  });

  test("a comment on a credential file is refused, on either side of the diff", async () => {
    const { repo, review } = setup();
    writeFileSync(join(repo, ".env"), "TOKEN=abc\n");
    const cases = [
      [".env", "new"],
      [".env.example", "new"],
      [".env.example", "old"],
    ] as const;
    for (const [path, side] of cases) {
      expect({ path, side, ...(await outcome(review.add(comment({ path, side })))) }).toEqual({
        path,
        side,
        code: "bad_request",
        reason: "review_file_secret",
      });
    }
    expect((await review.add(comment({}))).quote).toBe("one");
  });

  test("a comment through a link out of the repository is refused", async () => {
    const { repo, review } = setup();
    const outside = tempDir("fd-outside-");
    writeFileSync(join(outside, "notes.txt"), "outside\n");
    await linkDir(outside, join(repo, "link"));
    expect(await outcome(review.add(comment({ path: "link/notes.txt" })))).toEqual({
      code: "forbidden_cwd",
      reason: "review_path_link",
    });
  });

  test("a comment saved on a credential file before this fix lists without its quote", async () => {
    const { store, review } = setup();
    store.db
      .query(
        `INSERT INTO review_comments (id, target, path, side, line_start, line_end, quote, body, state, created_at, sent_at)
         VALUES ('c-1', 'session:s-1', '.env.example', 'new', 1, 1, 'TOKEN=committed', 'old', 'draft', '2026-11-01T12:00:00.000Z', NULL)`,
      )
      .run();
    const [listed] = await review.list("session:s-1");
    expect(listed).toMatchObject({ path: ".env.example", quote: "", outdated: true });
  });
});

describe("review-secrets: what cannot be read is not there, never an error (#509)", () => {
  test("a comment on a folder finds no lines; a comment whose file became a link out lists as outdated", async () => {
    const { repo, review } = setup();
    mkdirSync(join(repo, "folder"));
    const comment = { target: "session:s-1", side: "new" as const, lineStart: 1, lineEnd: 1 };
    expect(await outcome(review.add({ ...comment, path: "folder", body: "x" }))).toEqual({
      code: "bad_request",
      reason: "review_side_missing",
    });
    mkdirSync(join(repo, "docs"));
    writeFileSync(join(repo, "docs", "a.md"), "one\n");
    await review.add({ ...comment, path: "docs/a.md", body: "x" });
    const outside = tempDir("fd-outside-");
    writeFileSync(join(outside, "a.md"), "one\n");
    rmSync(join(repo, "docs"), { recursive: true });
    await linkDir(outside, join(repo, "docs"));
    expect(await outcome(review.list("session:s-1"))).toEqual({ code: "ok", reason: null });
    const [listed] = await review.list("session:s-1");
    expect(listed).toMatchObject({ path: "docs/a.md", outdated: true });
  });

  test("writing a file that is not there is a conflict, whatever hash comes with it", async () => {
    const { files } = setup();
    expect(await outcome(files.write("session:s-1", "new.txt", "x", "0".repeat(64)))).toEqual({
      code: "file_conflict",
      reason: "review_file_changed",
    });
  });
});

describe("review-secrets: .git stays out of reach, by any spelling or link (#509)", () => {
  test("file.read and file.write refuse .git written with ./, in another case or with a trailing dot", async () => {
    const { repo, files } = setup();
    const paths = ["./.git/config", ".//.git/HEAD", ".GIT/config", ".Git/HEAD", ".git./config"];
    for (const path of paths) {
      expect({ path, ...(await outcome(files.read("session:s-1", path))) }).toEqual({
        path,
        code: "bad_request",
        reason: "review_path_outside",
      });
    }
    const config = await Bun.file(join(repo, ".git", "config")).text();
    const hash = new Bun.CryptoHasher("sha256").update(config).digest("hex");
    const write = files.write("session:s-1", "./.git/config", "[core]\n", hash);
    expect(await outcome(write)).toEqual({ code: "bad_request", reason: "review_path_outside" });
    expect(await Bun.file(join(repo, ".git", "config")).text()).toBe(config);
  });

  test("a file that is not there yet is judged by the folder it would go in: a link into .git or out is refused", async () => {
    const { repo, files } = setup();
    await linkDir(join(repo, ".git"), join(repo, "meta"));
    const outside = tempDir("fd-outside-");
    await linkDir(outside, join(repo, "away"));
    const hook = files.write("session:s-1", "meta/hooks/pre-commit", "echo hi\n", "");
    expect(await outcome(hook)).toEqual({ code: "bad_request", reason: "review_path_outside" });
    const away = files.write("session:s-1", "away/deep/new.txt", "x\n", "");
    expect(await outcome(away)).toEqual({ code: "forbidden_cwd", reason: "review_path_link" });
    const revert = files.revert("session:s-1", "meta/hooks/post-checkout", true);
    expect(await outcome(revert)).toEqual({ code: "bad_request", reason: "review_path_outside" });
    // A new file inside the repository is judged the same way and is not refused for it.
    const fresh = files.write("session:s-1", "new/deep/file.txt", "x\n", "");
    expect(await outcome(fresh)).toEqual({ code: "file_conflict", reason: "review_file_changed" });
  });

  test("a link that leads nowhere yet is refused, wherever it would lead", async () => {
    const { repo, files } = setup();
    const outside = tempDir("fd-outside-");
    await linkDir(join(outside, "new"), join(repo, "dangling"));
    await linkDir(join(repo, ".git", "hooks", "later"), join(repo, "hook"));
    for (const path of ["dangling", "dangling/x.txt", "hook"]) {
      const written = files.write("session:s-1", path, "x\n", "");
      expect({ path, ...(await outcome(written)) }).toEqual({
        path,
        code: "forbidden_cwd",
        reason: "review_path_link",
      });
    }
  });

  test("a link into .git is refused like .git itself", async () => {
    const { repo, files } = setup();
    await linkDir(join(repo, ".git"), join(repo, "meta"));
    expect(await outcome(files.read("session:s-1", "meta/HEAD"))).toEqual({
      code: "bad_request",
      reason: "review_path_outside",
    });
  });
});
