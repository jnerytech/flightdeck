import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Changes } from "../../src/review/changes.ts";
import { ReviewComments, type ReviewCommentsOptions } from "../../src/review/comments.ts";
import { git } from "./board-helpers.ts";
import { newManager, poll } from "./helpers.ts";

/** A repository in the manager's allowed root, `a.txt` changed after the first commit. */
export async function session(overrides: Partial<ReviewCommentsOptions> = {}) {
  const ctx = newManager();
  const repo = ctx.project;
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  git(repo, "config", "core.autocrlf", "false");
  writeFileSync(join(repo, "a.txt"), "um\ndois\ntrês\nquatro\n");
  writeFileSync(join(repo, "b.txt"), "bê\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "inicial");
  writeFileSync(join(repo, "a.txt"), "um\ndois\ntrês\nquatro\ncinco\n");
  const { sessionId } = await ctx.manager.create({ cwd: repo, prompt: "oi" });
  await poll(() => ctx.manager.get(sessionId).status === "idle");
  const claudeId = ctx.manager.get(sessionId).claudeSessionId as string;
  const changes = new Changes({ db: ctx.store.db });
  const review = new ReviewComments({
    db: ctx.store.db,
    changes,
    manager: ctx.manager,
    now: () => Date.UTC(2026, 9, 1, 12),
    ...overrides,
  });
  return { ...ctx, repo, sessionId, target: `session:${claudeId}`, changes, review };
}
