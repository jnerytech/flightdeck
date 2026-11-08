import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SecretScanner } from "@flightdeck/protocol";
import { applyHarness } from "../src/harness/apply.ts";
import { commitHarness } from "../src/harness/commit.ts";
import { previewHarness } from "../src/harness/preview.ts";
import { git } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";

/**
 * Issue #75, slice C1: what the harness apply wrote is committed on a new branch the host names,
 * through a temporary index, with the person's identity: their branch, index and files stay as they
 * are, no hook of the repository runs, and a secret or a changed file refuses.
 */
const SETTINGS = ".claude/settings.json";
const ALL = ["claudeMd", "hooks", "skills", "agents", "permissions"] as const;
const AT = () => new Date("2026-11-08T14:05:00Z");
const posix = process.platform !== "win32";

/** A repository with one commit, a person's identity, and a Bun project to set up. */
function repo(options: { identity?: boolean; commit?: boolean } = {}) {
  const root = tempDir("fd-harness-commit-");
  git(root, "init", "-q", "-b", "main");
  if (options.identity ?? true) {
    git(root, "config", "user.name", "Ana");
    git(root, "config", "user.email", "ana@example.com");
  }
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ scripts: { test: "bun test", format: "biome format ." } }),
  );
  writeFileSync(join(root, "bun.lock"), "");
  if (options.commit ?? true) {
    git(root, "add", "--", "package.json", "bun.lock");
    git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "start");
  }
  return root;
}

async function applied(root: string) {
  const preview = await previewHarness(root, ALL);
  const digests: Record<string, string> = {};
  if (preview.settings) digests[preview.settings.path] = preview.settings.digest;
  for (const file of preview.files) digests[file.path] = file.digest;
  return applyHarness(root, ALL, digests);
}

const scanner = (values: string[] = []) => new SecretScanner(() => values);

/** A git call whose failure (a branch that is not there) is a value, not an error. */
function maybe(cwd: string, ...args: string[]): string | null {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
}

async function outcome(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return "ok";
  } catch (error) {
    return (error as { reason?: string }).reason ?? String(error);
  }
}

describe("harness-commit: the setup is committed on a new branch, nothing else moves (#75)", () => {
  test("the files apply wrote are committed whole on a new branch, with the person's identity", async () => {
    const root = repo();
    const done = await applied(root);
    const before = git(root, "status", "--porcelain");
    const made = await commitHarness(root, done.digests ?? {}, { scanner: scanner(), now: AT });
    const branch = "flightdeck/claude-setup-20261108-1405";
    expect([
      made.branch,
      made.files.sort(),
      git(root, "rev-parse", "--abbrev-ref", "HEAD"),
      git(root, "status", "--porcelain") === before,
      maybe(root, "log", "-1", "--format=%an <%ae>", branch),
      maybe(root, "diff", "--quiet", branch, "--", ...done.written) === "",
      maybe(root, "rev-parse", `${branch}^`) === git(root, "rev-parse", "main"),
    ]).toEqual([
      branch,
      [...done.written].sort(),
      "main",
      true,
      "Ana <ana@example.com>",
      true,
      true,
    ]);
  });

  test("a file changed since the apply, or a path that is not the setup's, is refused and no branch is made", async () => {
    const root = repo();
    const done = await applied(root);
    writeFileSync(join(root, "CLAUDE.md"), "# Mine now\n");
    writeFileSync(join(root, ".env"), "KEY=1\n");
    const changed = await outcome(
      commitHarness(root, done.digests ?? {}, { scanner: scanner(), now: AT }),
    );
    const other = await outcome(
      commitHarness(root, { ".env": "x".repeat(64) }, { scanner: scanner(), now: AT }),
    );
    expect([changed, other, git(root, "branch", "--list", "flightdeck/*")]).toEqual([
      "harness_commit_stale",
      "harness_commit_stale",
      "",
    ]);
  });

  test("a repository with no commit, or no identity, refuses with its reason", async () => {
    const empty = repo({ commit: false });
    const nameless = repo({ identity: false });
    const noHead = await outcome(
      applied(empty).then((done) =>
        commitHarness(empty, done.digests ?? {}, { scanner: scanner(), now: AT }),
      ),
    );
    const noName = await outcome(
      applied(nameless).then((done) =>
        commitHarness(nameless, done.digests ?? {}, { scanner: scanner(), now: AT }),
      ),
    );
    expect([noHead, noName]).toEqual(["harness_commit_no_head", "harness_commit_identity"]);
  });

  test("a secret in a file to commit refuses, and the same name twice is refused, never moved", async () => {
    const root = repo();
    const done = await applied(root);
    const secret = await outcome(
      commitHarness(root, done.digests ?? {}, {
        // A vault value that the written CLAUDE.md holds.
        scanner: scanner(["bun run test"]),
        now: AT,
      }),
    );
    const first = await outcome(
      commitHarness(root, done.digests ?? {}, { scanner: scanner(), now: AT }),
    );
    const tip = maybe(root, "rev-parse", "flightdeck/claude-setup-20261108-1405");
    const again = await outcome(
      commitHarness(root, done.digests ?? {}, { scanner: scanner(), now: AT }),
    );
    expect([
      secret,
      first,
      again,
      tip !== null && maybe(root, "rev-parse", "flightdeck/claude-setup-20261108-1405") === tip,
    ]).toEqual(["harness_commit_secret", "ok", "harness_commit_branch_taken", true]);
  });

  test.skipIf(!posix)(
    "no hook of the repository runs, a reference-transaction hook included",
    async () => {
      const root = repo();
      const hooks = join(root, "my-hooks");
      mkdirSync(hooks);
      const marker = join(root, "hook-ran");
      for (const name of ["reference-transaction", "post-commit", "pre-commit"]) {
        writeFileSync(join(hooks, name), `#!/bin/sh\ntouch "${marker}"\n`);
        chmodSync(join(hooks, name), 0o755);
      }
      git(root, "config", "core.hooksPath", hooks);
      const done = await applied(root);
      const made = await outcome(
        commitHarness(root, done.digests ?? {}, { scanner: scanner(), now: AT }),
      );
      expect([
        made,
        maybe(root, "rev-parse", "flightdeck/claude-setup-20261108-1405") !== null,
        existsSync(marker),
      ]).toEqual(["ok", true, false]);
    },
  );
});
