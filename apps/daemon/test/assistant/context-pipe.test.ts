import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractRules, repoContext } from "../../src/assistant/context.ts";
import { deps } from "../support/assistant-context.ts";
import { gitRepo } from "../support/board-helpers.ts";
import { tempDir } from "../support/helpers.ts";

const POSIX = process.platform !== "win32";

describe("assistant-context: a named pipe in the repository or among the rules", () => {
  // The security review of the daemon slice (2026-11-05): nothing outside the repository and no
  // secret reaches the prompt. Each fake value below must not appear in the bundle.
  test.skipIf(!POSIX)(
    "an untracked link or huge file is listed but never read, and a FIFO (which git skips) blocks nothing",
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
      expect("failed" in outcome ? outcome.failed : null).toBeNull();
      const bundle = outcome as Awaited<ReturnType<typeof repoContext>>;
      const all = JSON.stringify(bundle);
      expect([
        all.includes("fake-outside-value"),
        all.includes("fake-env-value"),
        all.includes("hhhhhhhh"),
      ]).toEqual([false, false, false]);
      expect(bundle.notShown).toEqual([".env", "folder-link", "huge.txt", "innocent.txt"]);
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
});
