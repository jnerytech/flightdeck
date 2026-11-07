import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Changes } from "../src/review/changes.ts";
import { ReviewFiles } from "../src/review/files.ts";
import { newBoard } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #797: the context panel shows a project's own checkout. `project:<id>` resolves on the
 * daemon from the project's record, inside the allowed roots, and only reads: the panel never
 * edits the primary checkout.
 */
async function setup(roots?: (root: string) => string[]) {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop?.());
  writeFileSync(join(ctx.repo, "panel.ts"), "export const panel = 1;\n");
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const allowedRoots = roots ? roots(ctx.root) : [ctx.root];
  const changes = new Changes({ db: ctx.store.db, board: ctx.board, allowedRoots });
  const files = new ReviewFiles({ changes, dataDir: tempDir("fd-data-"), allowedRoots });
  return { ...ctx, project, changes, files, target: `project:${project.id}` };
}

const reason = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: { reason?: string }) => error.reason ?? "error",
  );

describe("project-target: a project's own checkout, read only (#797)", () => {
  test("a project's files list and read, and its changes come against HEAD", async () => {
    const { files, changes, target, repo } = await setup();
    const listing = await files.list(target, "").catch(() => null);
    const file = await files.read(target, "panel.ts").catch(() => null);
    const diff = await changes.get(target).catch(() => null);
    expect([
      listing?.entries.some((entry) => entry.name === "panel.ts") ?? false,
      file?.text ?? null,
      diff?.root ?? null,
      diff?.base ?? "none",
      diff?.files.map((f) => f.path) ?? [],
    ]).toEqual([true, "export const panel = 1;\n", realpathSync(repo), null, ["panel.ts"]]);
  });

  test("a project never takes a write or a revert", async () => {
    const { files, target } = await setup();
    const read = await files.read(target, "panel.ts").catch(() => null);
    expect(
      await Promise.all([
        reason(files.write(target, "panel.ts", "changed\n", read?.hash ?? "")),
        reason(files.revert(target, "panel.ts", true)),
      ]),
    ).toEqual(["review_target_invalid", "review_target_invalid"]);
  });

  test("an unknown project, a daemon with no board, or a project outside the allowed roots is refused", async () => {
    const { files, target, store } = await setup();
    const elsewhere = await setup(() => [tempDir("fd-other-root-")]);
    const boardless = new ReviewFiles({
      changes: new Changes({ db: store.db, allowedRoots: [tempDir("fd-any-")] }),
      dataDir: tempDir("fd-data-"),
      allowedRoots: [],
    });
    expect(
      await Promise.all([
        reason(files.list("project:nope", "")),
        reason(boardless.list(target, "")),
        reason(elsewhere.files.list(elsewhere.target, "")),
      ]),
    ).toEqual(["project_not_found", "project_not_found", "cwd_outside_roots"]);
  });
});
