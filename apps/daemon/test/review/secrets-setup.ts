import { writeFileSync } from "node:fs";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { Changes } from "../../src/review/changes.ts";
import { ReviewComments } from "../../src/review/comments.ts";
import { ReviewFiles } from "../../src/review/files.ts";
import { git } from "../support/board-helpers.ts";
import { newManager, tempDir } from "../support/helpers.ts";
import { insertSession } from "../support/usage-helpers.ts";

/** A repository in the allowed root, a session `s-1` on it, `a.txt` and `.env.example` committed. */
export function setup() {
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
export const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => ({ code: "ok", reason: null }),
    (error: { code?: string; reason?: string }) => ({
      code: error.code ?? "",
      reason: error.reason ?? null,
    }),
  );

/** A folder link: a junction on Windows, which needs no privilege; a plain link elsewhere. */
export const linkDir = (target: string, path: string) => symlink(target, path, "junction");
