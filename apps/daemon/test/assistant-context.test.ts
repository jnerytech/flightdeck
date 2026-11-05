import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SecretScanner } from "@flightdeck/protocol";
import { type ContextDeps, extractRules, repoContext } from "../src/assistant/context.ts";
import { FlightdeckError } from "../src/errors.ts";
import { credential, isCredentialPath } from "../src/permissions/risk.ts";
import { REMOVED_LINE } from "../src/watch/trace.ts";
import { git, gitRepo } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";

const POSIX = process.platform !== "win32";

/** Deps over a real repository; a card is a branch of it against `main`. */
function deps(repo: string): ContextDeps {
  return {
    card: (cardId) => {
      if (cardId !== "c1") throw new FlightdeckError("not_found", "no card", "card_not_found");
      return { worktree: repo, base: "main" };
    },
    allowed: async (cwd) => cwd,
    scanner: new SecretScanner(),
  };
}

async function reason(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof FlightdeckError ? error.reason : String(error);
  }
}

describe("assistant-context", () => {
  test("a card: its branch against the base and its working changes, with a stat and no author data", async () => {
    const { repo } = gitRepo();
    git(repo, "checkout", "-q", "-b", "feature");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    git(repo, "add", "a.ts");
    git(
      repo,
      "-c",
      "user.name=Ana Secreta",
      "-c",
      "user.email=ana@example.com",
      "commit",
      "-q",
      "-m",
      "feat: a",
    );
    writeFileSync(join(repo, "README.md"), "# repo\nmore\n");
    const bundle = await repoContext({ kind: "card", cardId: "c1" }, deps(repo));
    expect(bundle.stat).toBe(" README.md | 1 +\n a.ts      | 1 +");
    expect(bundle.diff).toBe(
      "--- README.md\n@@ -1 +1,2 @@\n # repo\n+more\n--- a.ts\n@@ -0,0 +1 @@\n+export const a = 1;",
    );
    expect([bundle.notShown, bundle.redactedLines, bundle.truncated]).toEqual([[], 0, false]);
    const all = JSON.stringify(bundle);
    expect([
      all.includes("Ana Secreta"),
      all.includes("ana@example.com"),
      /[0-9a-f]{40}/.test(all),
    ]).toEqual([false, false, false]);
  });

  test("the working tree has its changes and untracked files; staged has only what is staged", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, "README.md"), "# repo\nedited\n");
    writeFileSync(join(repo, "new.txt"), "fresh\n");
    const worktree = await repoContext({ kind: "worktree", cwd: repo }, deps(repo));
    expect(worktree.stat).toBe(" README.md | 1 +\n new.txt   | 1 +");
    git(repo, "add", "new.txt");
    const staged = await repoContext({ kind: "staged", cwd: repo }, deps(repo));
    expect(staged.stat).toBe(" new.txt | 1 +");
    expect(staged.diff).toBe("--- new.txt\n@@ -0,0 +1 @@\n+fresh");
  });

  test("no changes and a folder that is not a repository are refused with their reasons", async () => {
    const { repo } = gitRepo();
    expect(await reason(repoContext({ kind: "worktree", cwd: repo }, deps(repo)))).toBe(
      "assistant_no_changes",
    );
    expect(await reason(repoContext({ kind: "staged", cwd: repo }, deps(repo)))).toBe(
      "assistant_no_changes",
    );
    const plain = tempDir("fd-assistant-plain-");
    expect(await reason(repoContext({ kind: "worktree", cwd: plain }, deps(plain)))).toBe(
      "assistant_not_a_repo",
    );
  });

  test("binary, lockfile, minified, generated, build output and credential files are listed but not shown", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, "logo.png"), Buffer.from([0, 1, 2, 0, 255]));
    writeFileSync(join(repo, "bun.lock"), "lock\n");
    writeFileSync(join(repo, "app.min.js"), "x\n");
    mkdirSync(join(repo, "dist"));
    writeFileSync(join(repo, "dist", "out.js"), "x\n");
    writeFileSync(join(repo, "schema.generated.ts"), "x\n");
    writeFileSync(join(repo, ".env"), "TOKEN=abc\n");
    writeFileSync(join(repo, "keep.ts"), "keep\n");
    const bundle = await repoContext({ kind: "worktree", cwd: repo }, deps(repo));
    expect(bundle.notShown).toEqual([
      ".env",
      "app.min.js",
      "bun.lock",
      "dist/out.js",
      "logo.png",
      "schema.generated.ts",
    ]);
    expect(bundle.diff).toBe("--- keep.ts\n@@ -0,0 +1,1 @@\n+keep");
    expect(isCredentialPath).toBe(credential);
  });

  test("a line that looks like a secret is replaced and counted", async () => {
    const { repo } = gitRepo();
    writeFileSync(
      join(repo, "config.ts"),
      'const url = "x";\nconst password = "hunter2hunter2";\n',
    );
    const bundle = await repoContext({ kind: "worktree", cwd: repo }, deps(repo));
    expect(bundle.diff).toBe(`--- config.ts\n@@ -0,0 +1,2 @@\n+const url = "x";\n+${REMOVED_LINE}`);
    expect(bundle.redactedLines).toBe(1);
  });

  test("the budget: 6 KB a file, 48 KB in all, smaller files first, then the rest named as not shown", async () => {
    const { repo } = gitRepo();
    writeFileSync(join(repo, "big.txt"), `${"b".repeat(80)}\n`.repeat(100));
    for (let i = 0; i < 12; i++) {
      writeFileSync(
        join(repo, `f${String(i).padStart(2, "0")}.txt`),
        `${"m".repeat(80)}\n`.repeat(55 + i),
      );
    }
    writeFileSync(join(repo, "tiny.txt"), "t\n");
    const bundle = await repoContext({ kind: "worktree", cwd: repo }, deps(repo));
    const files = bundle.diff.split("\n").filter((l) => l.startsWith("--- "));
    expect(files.slice(0, 2)).toEqual(["--- tiny.txt", "--- f00.txt"]);
    expect(bundle.diff.length).toBeLessThanOrEqual(48 * 1024);
    expect(bundle.truncated).toBe(true);
    expect(bundle.notShown.length).toBeGreaterThan(0);
    expect(bundle.notShown).toContain("big.txt");
    expect(bundle.stat.split("\n").length).toBe(14);
    const perFile = bundle.diff.split("\n--- ").map((part) => part.length);
    expect(Math.max(...perFile)).toBeLessThanOrEqual(6 * 1024 + 64);
  });

  test("the repo's rules: the blocks of its own CLAUDE.md that are about commits, and nothing else", async () => {
    const repo = tempDir("fd-assistant-rules-");
    copyFileSync(
      join(import.meta.dir, "fixtures", "assistant", "CLAUDE.md"),
      join(repo, "CLAUDE.md"),
    );
    const rules = await extractRules(repo);
    expect(rules.startsWith("- `.claude/`: the shared Claude Code setup.")).toBe(true);
    expect(rules).toContain(
      "- Everything new written to the codebase is in English: code, identifiers, comments, commit",
    );
    expect(rules.includes("- `apps/daemon`: the `flightdeckd` daemon.")).toBe(false);
    expect(rules.includes("# Flightdeck")).toBe(false);
    expect(rules.length).toBeLessThanOrEqual(4096);
    for (const block of rules.split("\n\n")) {
      expect([
        block.slice(0, 40),
        /commit|conventional|scope|pr title|message/i.test(block),
      ]).toEqual([block.slice(0, 40), true]);
    }
  });

  test("AGENTS.md, commitlint and .gitmessage join the rules; git log gives the subjects and the conventional flag", async () => {
    const { repo } = gitRepo();
    writeFileSync(
      join(repo, "AGENTS.md"),
      "# Agents\n\nBe brief.\n\nCommit messages use the imperative.\n",
    );
    writeFileSync(
      join(repo, "commitlint.config.js"),
      "module.exports = { extends: ['@commitlint/config-conventional'] };\n",
    );
    writeFileSync(join(repo, ".gitmessage"), `${"g".repeat(2000)}\n`);
    expect(await extractRules(repo)).toBe(
      `Commit messages use the imperative.\n\nmodule.exports = { extends: ['@commitlint/config-conventional'] };\n\n${"g".repeat(1024)}`,
    );
    for (const subject of ["feat: one", "fix(x): two", "Update docs"]) {
      writeFileSync(join(repo, "README.md"), `# ${subject}\n`);
      git(repo, "commit", "-q", "-am", subject);
    }
    writeFileSync(join(repo, "README.md"), "# changed\n");
    const bundle = await repoContext({ kind: "worktree", cwd: repo }, deps(repo));
    expect([bundle.recent, bundle.conventional]).toEqual([
      ["Update docs", "fix(x): two", "feat: one", "inicial"],
      true,
    ]);
    git(repo, "commit", "-q", "-am", "Tidy up");
    writeFileSync(join(repo, "README.md"), "# again\n");
    const after = await repoContext({ kind: "worktree", cwd: repo }, deps(repo));
    expect(after.conventional).toBe(false);
  });

  // The security review of the daemon slice (2026-11-05): nothing outside the repository and no
  // secret reaches the prompt. Each fake value below must not appear in the bundle.
  test.skipIf(!POSIX)(
    "an untracked link, directory, FIFO or huge file is listed but never read",
    async () => {
      const outside = tempDir("fd-assistant-outside-");
      writeFileSync(join(outside, "secret.txt"), "TOPSECRET_OUTSIDE=fake-outside-value\n");
      const { repo } = gitRepo();
      symlinkSync(join(outside, "secret.txt"), join(repo, "innocent.txt"));
      symlinkSync(outside, join(repo, "folder-link"));
      Bun.spawnSync(["mkfifo", join(repo, "pipe")]);
      writeFileSync(join(repo, "huge.txt"), "h".repeat(300 * 1024));
      writeFileSync(join(repo, ".env"), "API=fake-env-value\n");
      writeFileSync(join(repo, "keep.ts"), "keep\n");
      const outcome = await repoContext({ kind: "worktree", cwd: repo }, deps(repo)).catch(
        (error: unknown) => ({ failed: String(error) }),
      );
      expect("failed" in outcome ? outcome.failed : null).toBe(null);
      const bundle = outcome as Awaited<ReturnType<typeof repoContext>>;
      const all = JSON.stringify(bundle);
      expect([
        all.includes("fake-outside-value"),
        all.includes("fake-env-value"),
        all.includes("hhhhhhhh"),
      ]).toEqual([false, false, false]);
      expect(bundle.notShown).toEqual([".env", "folder-link", "huge.txt", "innocent.txt", "pipe"]);
      expect(bundle.diff).toBe("--- keep.ts\n@@ -0,0 +1,1 @@\n+keep");
    },
  );

  test.skipIf(!POSIX)(
    "the rules read no link, directory or FIFO, and no more than their cap of a file",
    async () => {
      const outside = tempDir("fd-assistant-outside-");
      writeFileSync(join(outside, "secret.txt"), "commit secret fake-rules-value\n");
      const root = tempDir("fd-assistant-rules-");
      symlinkSync(join(outside, "secret.txt"), join(root, ".gitmessage"));
      symlinkSync(join(outside, "secret.txt"), join(root, "CLAUDE.md"));
      mkdirSync(join(root, "AGENTS.md"));
      const rules = (dir: string) =>
        Promise.resolve()
          .then(() => extractRules(dir))
          .catch((error: unknown) => `failed: ${String(error)}`);
      expect(await rules(root)).toBe("");
      const fifo = tempDir("fd-assistant-rules-");
      Bun.spawnSync(["mkfifo", join(fifo, "AGENTS.md")]);
      writeFileSync(join(fifo, "commitlint.config.js"), `${"c".repeat(5000)}\n`);
      expect(await rules(fifo)).toBe("c".repeat(1024));
    },
  );

  test("named secrets, prefixed keys, auth headers and the whole of a private key are taken out of the diff", async () => {
    const { repo } = gitRepo();
    const lines = [
      "DB_PASSWORD=fake-db-1111",
      "aws_secret_access_key = fake-aws-2222",
      "GITHUB_TOKEN=fake-gh-3333",
      "STRIPE_SECRET=fake-stripe-4444",
      "client_secret: fake-client-5555",
      "//registry.npmjs.org/:_authToken=fake-npm-6666",
      "Authorization: Basic ZmFrZS1iYXNpYy03Nzc3",
      "-----BEGIN RSA PRIVATE KEY-----",
      "fake-pem-body-8888",
      "fake-pem-body-9999",
      "-----END RSA PRIVATE KEY-----",
      "plain line",
    ];
    writeFileSync(join(repo, "notes.txt"), `${lines.join("\n")}\n`);
    const bundle = await repoContext({ kind: "worktree", cwd: repo }, deps(repo));
    expect(bundle.diff.split("\n").filter((l) => l.startsWith("+"))).toEqual([
      ...lines.slice(0, -1).map(() => `+${REMOVED_LINE}`),
      "+plain line",
    ]);
    expect(bundle.redactedLines).toBe(11);
  });
});
