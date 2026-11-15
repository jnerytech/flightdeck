import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findRg, searchRepository } from "../../src/review/search.ts";
import { git } from "../support/board-helpers.ts";
import { tempDir } from "../support/helpers.ts";
import { event, failure, fakeRg, onWindows, setup, teardown } from "./repo-search-setup.ts";

afterEach(teardown);

describe("repo-search: a repository searched by name and by content (#797)", () => {
  test("by name: tracked and new files, case aside, never an ignored one or a link that leaves; a credential is marked", async () => {
    const { repo } = await setup();
    const panel = await searchRepository(repo, { mode: "name", query: "PANEL" });
    const env = await searchRepository(repo, { mode: "name", query: ".env" });
    // A link with a plain name to a credential is one too.
    const link = onWindows
      ? [{ path: "keys-link.txt", secret: true }]
      : (await searchRepository(repo, { mode: "name", query: "keys-link" })).matches;
    const one = await searchRepository(repo, { mode: "name", query: "panel", limit: 1 });
    expect([panel, env.matches, link, [one.matches.length, one.truncated]]).toEqual([
      {
        mode: "name",
        query: "PANEL",
        matches: [{ path: "notes/Readme-Panel.md" }, { path: "src/panel.ts" }],
        truncated: false,
      },
      [{ path: ".env", secret: true }],
      [{ path: "keys-link.txt", secret: true }],
      [1, true],
    ]);
  });

  test("by content without rg: git grep finds the lines of new files too, cut to 200 characters, never a credential's or an ignored file's (#869)", async () => {
    const { repo } = await setup();
    const found = await searchRepository(
      repo,
      { mode: "content", query: "PANEL" },
      { rg: () => null },
    );
    expect([
      // Every file setup writes is new: none was ever added, so git grep reads untracked files.
      git(repo, "ls-files", "--", "src", "ignored").trim(),
      found.matches.map((m) => [m.path, m.line, m.text?.length]),
      found.matches.find((m) => m.line === 2)?.text ?? null,
      found.truncated,
    ]).toEqual([
      "",
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
    "rg's no match is an empty answer, and its failure is refused",
    async () => {
      const { repo } = await setup();
      const none = fakeRg("", 1);
      const broken = fakeRg("", 2);
      expect([
        (await searchRepository(repo, { mode: "content", query: "x" }, { rg: () => none.path }))
          .matches,
        await failure(
          searchRepository(repo, { mode: "content", query: "x" }, { rg: () => broken.path }),
        ),
      ]).toEqual([[], "command_failed"]);
    },
  );

  test("an rg line of the wrong shape is skipped, and the valid ones are kept (#1609)", async () => {
    const { repo } = await setup();
    const odd = JSON.stringify({
      type: "match",
      data: { path: { text: 5 }, lines: { text: "x" }, line_number: 1 },
    });
    const found = await searchRepository(
      repo,
      { mode: "content", query: "panel" },
      {
        rg: () => "rg",
        run: async () => ({
          code: 0,
          stdout: `${odd}\n${event({ text: "./src/panel.ts" }, 1, { text: "panel\n" })}\n`,
          stderr: "",
          truncated: false,
          timedOut: false,
        }),
      },
    );
    expect(found.matches.map((m) => m.path)).toEqual(["src/panel.ts"]);
  });

  test("an rg cut by its time limit keeps what it found and says it was cut", async () => {
    const { repo } = await setup();
    const found = await searchRepository(
      repo,
      { mode: "content", query: "panel" },
      {
        rg: () => "rg",
        // The runner's answer when the limit killed the program: no real clock, no real process.
        run: async () => ({
          code: 137,
          stdout: `${event({ text: "./src/panel.ts" }, 1, { text: "panel\n" })}\n`,
          stderr: "",
          truncated: false,
          timedOut: true,
        }),
      },
    );
    expect([found.matches.map((m) => m.path), found.truncated]).toEqual([["src/panel.ts"], true]);
  });

  test.skipIf(onWindows)(
    "a git without --max-count still searches content, at most 5 lines of a file, a query that starts with - included",
    async () => {
      const { repo } = await setup();
      writeFileSync(
        join(repo, "notes", "flags.md"),
        `${Array.from({ length: 7 }, (_, i) => `use -e here ${i}`).join("\n")}\n`,
      );
      // A git older than 2.38: --max-count is an unknown option there.
      const real = Bun.which("git", { PATH: process.env.PATH ?? "" }) ?? "git";
      const bin = tempDir("fd-old-git-");
      writeFileSync(
        join(bin, "git"),
        [
          "#!/bin/sh",
          'for a in "$@"; do case "$a" in --max-count*) echo "error: unknown option" >&2; exit 129;; esac; done',
          `exec '${real}' "$@"`,
          "",
        ].join("\n"),
      );
      chmodSync(join(bin, "git"), 0o755);
      const path = process.env.PATH;
      process.env.PATH = `${bin}:${path ?? ""}`;
      try {
        const found = await searchRepository(
          repo,
          { mode: "content", query: "-e here" },
          { rg: () => null },
        ).then(
          (result) => result.matches.map((m) => [m.path, m.line]),
          (error: { reason?: string }) => error.reason ?? "error",
        );
        expect(found).toEqual([
          ["notes/flags.md", 1],
          ["notes/flags.md", 2],
          ["notes/flags.md", 3],
          ["notes/flags.md", 4],
          ["notes/flags.md", 5],
        ]);
      } finally {
        process.env.PATH = path;
      }
    },
  );

  test.skipIf(onWindows)("rg on a folder that is no repository is never run", async () => {
    const plain = tempDir("fd-plain-rg-");
    writeFileSync(join(plain, "panel.ts"), "panel\n");
    const rg = fakeRg(event({ text: "./panel.ts" }, 1, { text: "panel\n" }));
    expect([
      await failure(
        searchRepository(plain, { mode: "content", query: "panel" }, { rg: () => rg.path }),
      ),
      rg.args(),
    ]).toEqual(["repo_not_git", []]);
  });

  test.skipIf(onWindows)("a backslash is part of a name outside Windows", async () => {
    const { repo } = await setup();
    writeFileSync(join(repo, "a\\b.ts"), "panel\n");
    const rg = fakeRg(event({ text: "./a\\b.ts" }, 1, { text: "panel\n" }));
    const found = await searchRepository(
      repo,
      { mode: "content", query: "panel" },
      { rg: () => rg.path },
    );
    expect(found.matches.map((m) => m.path)).toEqual(["a\\b.ts"]);
  });

  test("a file deleted from the working tree is not found, though git still lists it", async () => {
    const { repo } = await setup();
    writeFileSync(join(repo, "gone-panel.ts"), "panel\n");
    Bun.spawnSync(["git", "add", "gone-panel.ts"], { cwd: repo });
    rmSync(join(repo, "gone-panel.ts"));
    const found = await searchRepository(repo, { mode: "name", query: "gone-panel" }).then(
      (result) => result.matches,
      (error: { reason?: string }) => error.reason ?? "error",
    );
    expect(found).toEqual([]);
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
});
