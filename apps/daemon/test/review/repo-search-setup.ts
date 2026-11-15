import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Changes } from "../../src/review/changes.ts";
import { newBoard } from "../support/board-helpers.ts";
import { tempDir } from "../support/helpers.ts";

export const TOKEN = "repo-search-token-0123456789abcdef";
export const cleanups: Array<() => unknown> = [];
/** The afterEach of every repo-search file: what a test started, last first. */
export async function teardown() {
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

/**
 * Issue #797: the context panel searches a repository by name and by content. The daemon runs
 * `git ls-files`, `rg` or `git grep` with a fixed string, never through a shell, capped in matches,
 * bytes and time; a match outside the repository or in a credential's content never leaves it.
 */
export const onWindows = process.platform === "win32";

export async function setup() {
  const ctx = newBoard();
  const { repo } = ctx;
  mkdirSync(join(repo, "src"));
  mkdirSync(join(repo, "notes"));
  mkdirSync(join(repo, "ignored"));
  writeFileSync(join(repo, "src", "panel.ts"), "export const Panel = 1;\n// todo: panel\n");
  writeFileSync(join(repo, "src", "long.ts"), `panel ${"x".repeat(500)}\n`);
  writeFileSync(join(repo, "notes", "Readme-Panel.md"), "nothing here\n");
  writeFileSync(join(repo, ".env"), "PANEL_KEY=abc\n");
  writeFileSync(join(repo, ".gitignore"), "ignored/\n");
  writeFileSync(join(repo, "ignored", "panel.txt"), "panel\n");
  // A link whose name matches and which leads out of the repository, and one to a credential.
  // Windows may refuse links without its developer mode: those files are then simply not there.
  const outside = tempDir("fd-outside-");
  writeFileSync(join(outside, "out.ts"), "panel outside\n");
  try {
    symlinkSync(join(outside, "out.ts"), join(repo, "panel-link.ts"));
    symlinkSync(".env", join(repo, "keys-link.txt"));
  } catch {
    // No links on this host.
  }
  const project = await ctx.board.addProject({ path: repo, promptTemplate: "" });
  const changes = new Changes({ db: ctx.store.db, board: ctx.board, allowedRoots: [ctx.root] });
  return { ...ctx, project, changes, target: `project:${project.id}` };
}

/** An `rg` that records its arguments and prints `out` (one JSON event per line), then exits with `code`. */
export function fakeRg(out: string, code = 0) {
  const dir = tempDir("fd-fake-rg-");
  writeFileSync(join(dir, "out.jsonl"), out);
  const script = [
    "#!/bin/sh",
    `printf '%s\\n' "$@" > '${join(dir, "args.txt")}'`,
    `cat '${join(dir, "out.jsonl")}'`,
    `exit ${code}`,
  ].join("\n");
  writeFileSync(join(dir, "rg"), `${script}\n`);
  chmodSync(join(dir, "rg"), 0o755);
  return {
    path: join(dir, "rg"),
    dir,
    // What it was called with; nothing when it never ran.
    args: () =>
      existsSync(join(dir, "args.txt"))
        ? readFileSync(join(dir, "args.txt"), "utf8").split("\n").slice(0, -1)
        : [],
  };
}

export const event = (path: { text: string } | { bytes: string }, line: number, lines: object) =>
  JSON.stringify({
    type: "match",
    data: { path, lines, line_number: line, absolute_offset: 0, submatches: [] },
  });

export const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: { reason?: string; code?: string }) => error.reason ?? error.code ?? "error",
  );
