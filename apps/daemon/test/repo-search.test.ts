import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Changes } from "../src/review/changes.ts";
import { ReviewFiles } from "../src/review/files.ts";
import { findRg, searchRepository } from "../src/review/search.ts";
import { startServer } from "../src/server.ts";
import { newBoard } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

const TOKEN = "repo-search-token-0123456789abcdef";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/**
 * Issue #797: the context panel searches a repository by name and by content. The daemon runs
 * `git ls-files`, `rg` or `git grep` with a fixed string, never through a shell, capped in matches,
 * bytes and time; a match outside the repository or in a credential's content never leaves it.
 */
const onWindows = process.platform === "win32";

async function setup() {
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
  // A link whose name matches and which leads out of the repository.
  const outside = tempDir("fd-outside-");
  writeFileSync(join(outside, "out.ts"), "panel outside\n");
  symlinkSync(join(outside, "out.ts"), join(repo, "panel-link.ts"));
  const project = await ctx.board.addProject({ path: repo, promptTemplate: "" });
  const changes = new Changes({ db: ctx.store.db, board: ctx.board, allowedRoots: [ctx.root] });
  return { ...ctx, project, changes, target: `project:${project.id}` };
}

/** An `rg` that records its arguments and prints `out` (one JSON event per line), then exits with `code`. */
function fakeRg(out: string, code = 0, sleepSeconds = 0) {
  const dir = tempDir("fd-fake-rg-");
  writeFileSync(join(dir, "out.jsonl"), out);
  const script = [
    "#!/bin/sh",
    `printf '%s\\n' "$@" > '${join(dir, "args.txt")}'`,
    ...(sleepSeconds ? [`sleep ${sleepSeconds}`] : []),
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

const event = (path: { text: string } | { bytes: string }, line: number, lines: object) =>
  JSON.stringify({
    type: "match",
    data: { path, lines, line_number: line, absolute_offset: 0, submatches: [] },
  });

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: { reason?: string; code?: string }) => error.reason ?? error.code ?? "error",
  );

describe("repo-search: a repository searched by name and by content (#797)", () => {
  test("by name: tracked and new files, case aside, never an ignored one or a link that leaves; a credential is marked", async () => {
    const { repo } = await setup();
    const panel = await searchRepository(repo, { mode: "name", query: "PANEL" });
    const env = await searchRepository(repo, { mode: "name", query: ".env" });
    const one = await searchRepository(repo, { mode: "name", query: "panel", limit: 1 });
    expect([panel, env.matches, [one.matches.length, one.truncated]]).toEqual([
      {
        mode: "name",
        query: "PANEL",
        matches: [{ path: "notes/Readme-Panel.md" }, { path: "src/panel.ts" }],
        truncated: false,
      },
      [{ path: ".env", secret: true }],
      [1, true],
    ]);
  });

  test("by content without rg: git grep finds the lines, cut to 200 characters, never a credential's", async () => {
    const { repo } = await setup();
    const found = await searchRepository(
      repo,
      { mode: "content", query: "PANEL" },
      { rg: () => null },
    );
    expect([
      found.matches.map((m) => [m.path, m.line, m.text?.length]),
      found.matches.find((m) => m.line === 2)?.text ?? null,
      found.truncated,
    ]).toEqual([
      [
        ["src/long.ts", 1, 200],
        ["src/panel.ts", 1, 23],
        ["src/panel.ts", 2, 14],
      ],
      "// todo: panel",
      false,
    ]);
  });

  test.skipIf(onWindows)(
    "by content with rg: a fixed string after --, no config, and only what stays in the repository",
    async () => {
      const { repo } = await setup();
      const rg = fakeRg(
        [
          JSON.stringify({ type: "begin", data: { path: { text: "./src/panel.ts" } } }),
          event({ text: "./src/panel.ts" }, 1, { text: "export const Panel = 1;\n" }),
          event({ text: "./.env" }, 1, { text: "PANEL_KEY=abc\n" }),
          event({ text: "./panel-link.ts" }, 1, { text: "panel outside\n" }),
          event({ bytes: "cGFuZWw=" }, 2, { text: "panel\n" }),
          event({ text: "./src/panel.ts" }, 4, { bytes: "/w==" }),
          event({ text: "./src/long.ts" }, 1, { text: `panel ${"x".repeat(500)}\n` }),
          "not an event",
          JSON.stringify({ type: "summary", data: {} }),
        ].join("\n"),
      );
      const found = await searchRepository(
        repo,
        { mode: "content", query: "--pre=sh" },
        { rg: () => rg.path },
      );
      expect([
        rg.args(),
        found.matches.map((m) => [m.path, m.line, m.text?.length]),
        found.truncated,
      ]).toEqual([
        [
          "--no-config",
          "--json",
          "--fixed-strings",
          "--ignore-case",
          "--max-count",
          "5",
          "--max-filesize",
          "1M",
          "--",
          "--pre=sh",
          ".",
        ],
        [
          ["src/panel.ts", 1, 23],
          ["src/long.ts", 1, 200],
        ],
        false,
      ]);
    },
  );

  test.skipIf(onWindows)(
    "rg's no match is an empty answer, its failure is refused, and one out of time is cut",
    async () => {
      const { repo } = await setup();
      const none = fakeRg("", 1);
      const broken = fakeRg("", 2);
      const slow = fakeRg(event({ text: "./src/panel.ts" }, 1, { text: "x\n" }), 0, 5);
      const started = Date.now();
      const late = await searchRepository(
        repo,
        { mode: "content", query: "x" },
        { rg: () => slow.path, timeoutMs: 100 },
      );
      expect([
        (await searchRepository(repo, { mode: "content", query: "x" }, { rg: () => none.path }))
          .matches,
        await failure(
          searchRepository(repo, { mode: "content", query: "x" }, { rg: () => broken.path }),
        ),
        late.truncated,
        Date.now() - started < 3000,
      ]).toEqual([[], "command_failed", true, true]);
    },
  );

  test("a folder that is no repository is refused by name, and its content search without rg fails", async () => {
    const plain = tempDir("fd-plain-");
    writeFileSync(join(plain, "panel.ts"), "panel\n");
    expect([
      await failure(searchRepository(plain, { mode: "name", query: "panel" })),
      await failure(
        searchRepository(plain, { mode: "content", query: "panel" }, { rg: () => null }),
      ),
    ]).toEqual(["repo_not_git", "command_failed"]);
  });

  test("a search runs on a repository target, never a terminal's folder", async () => {
    const { changes, target } = await setup();
    const files = new ReviewFiles({ changes, dataDir: tempDir("fd-data-"), allowedRoots: [] });
    const found = await files.search({ target, mode: "name", query: "panel.ts" }).catch(() => null);
    expect([
      found?.matches ?? null,
      await failure(files.search({ target: "terminal:t1", mode: "name", query: "x" })),
    ]).toEqual([[{ path: "src/panel.ts" }], "review_target_invalid"]);
  });

  test.skipIf(onWindows)("rg is looked up on the PATH, and its absence means git grep", () => {
    const rg = fakeRg("");
    const path = process.env.PATH;
    try {
      process.env.PATH = rg.dir;
      const found = findRg();
      process.env.PATH = "";
      expect([found, findRg()]).toEqual([rg.path, null]);
    } finally {
      process.env.PATH = path;
    }
  });

  test("the host announces file.search and answers it over the protocol", async () => {
    const ctx = await setup();
    const files = new ReviewFiles({
      changes: ctx.changes,
      dataDir: tempDir("fd-data-"),
      allowedRoots: [ctx.root],
    });
    const server = startServer({
      manager: ctx.manager,
      files,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: TOKEN,
      allowedRoots: [ctx.root],
    });
    cleanups.push(() => server.stop());
    const client = new FrameClient(server.url);
    cleanups.push(() => client.close());
    await client.request("hello", { token: TOKEN, client: "t" });
    const info = await client.data<{ features?: string[] }>("host.info", {});
    const found = await client.data<{ matches: Array<{ path: string }> }>("file.search", {
      target: ctx.target,
      mode: "name",
      query: "readme-panel",
    });
    expect([info?.features?.includes("file.search") ?? false, found?.matches ?? null]).toEqual([
      true,
      [{ path: "notes/Readme-Panel.md" }],
    ]);
  });
});
