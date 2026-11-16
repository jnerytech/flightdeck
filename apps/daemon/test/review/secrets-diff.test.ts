import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cardDiff, workingDiff } from "../../src/git/diff.ts";
import { parseUnifiedDiff } from "../../src/git/domain/diff-parse.ts";
import { refArg } from "../../src/kernel/index.ts";
import { git, gitRepo } from "../support/board-helpers.ts";

// Real git in temporary repositories: more than the default 5 s.
setDefaultTimeout(20_000);

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
