import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
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
import { insertSession } from "./usage-helpers.ts";

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
function fakeRg(out: string, code = 0) {
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

  test("by content, a token in a file that is no credential leaves the host masked, even one cut at 200 characters (#829)", async () => {
    const { repo } = await setup();
    // A fake token of GitHub's shape; the test never uses a real one.
    const token = `ghp_${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}`;
    writeFileSync(
      join(repo, "src", "config.js"),
      [
        `const panelToken = "${token}";`,
        `// panel ${"x".repeat(190)}${token}`,
        "-----BEGIN RSA PRIVATE KEY----- panel MIIEowIBAAKCAQEA",
      ].join("\n") + "\n",
    );
    const found = await searchRepository(
      repo,
      { mode: "content", query: "panel" },
      { rg: () => null },
    );
    const lines = found.matches.filter((m) => m.path === "src/config.js").map((m) => m.text ?? "");
    expect([
      lines.length,
      lines.some((text) => text.includes("ghp_") || text.includes("A1b2C3d4")),
      lines.some((text) => text.includes("MIIEowIBAAKCAQEA") || text.includes("PRIVATE KEY")),
      lines.every((text) => Array.from(text).length <= 200),
      lines[0] ?? "",
    ]).toEqual([3, false, false, true, 'const [redacted]";']);
  });

  test("a private key's body lines leave the host masked, without their header on the line (#829)", async () => {
    const { repo } = await setup();
    // A fake key body of PEM's shape: 64 base64 characters a line; not a real key.
    const body = "MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun";
    writeFileSync(
      join(repo, "notes", "setup.md"),
      `${body}\nMIIEpanelQEAu1SU1LfVLPHCozMxH2Mo4lg\n`,
    );
    const found = await searchRepository(
      repo,
      { mode: "content", query: "MIIE" },
      { rg: () => null },
    );
    const lines = found.matches.filter((m) => m.path === "notes/setup.md").map((m) => m.text);
    expect(lines).toEqual(["[redacted]", "[redacted]"]);
  });

  test("a key's body lines with quotes, a comment mark, a comma, a CR or short padding leave masked too (#829)", async () => {
    const { repo } = await setup();
    // Fake key body lines of PEM's shape; not a real key.
    const body = "MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun";
    writeFileSync(
      join(repo, "notes", "keys.js"),
      [
        `  "${body}",`,
        `# ${body}`,
        `// ${body}`,
        ` * ${body}`,
        `MIIEow\rIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOE`,
        "MIIEpQ0tRgeLe==",
      ].join("\n") + "\n",
    );
    const found = await searchRepository(
      repo,
      { mode: "content", query: "MIIE" },
      { rg: () => null },
    );
    const lines = found.matches.filter((m) => m.path === "notes/keys.js").map((m) => m.text);
    expect(lines).toEqual(Array(6).fill("[redacted]"));
  });

  test("a line of 100 000 characters leaves cut to 200, with no token from anywhere in it (#829)", async () => {
    const { repo } = await setup();
    // A fake token of GitHub's shape; the test never uses a real one.
    const token = `ghp_${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}`;
    // Each token stands apart, as one does in code; the first starts at 190, across the cut.
    const line = `panel ${"x".repeat(183)} ${token} ${"y".repeat(1000)} ${token} ${"z".repeat(98_000)}`;
    writeFileSync(join(repo, "src", "huge.js"), `${line}\n`);
    const found = await searchRepository(
      repo,
      { mode: "content", query: "panel" },
      { rg: () => null },
    );
    const text = found.matches.find((m) => m.path === "src/huge.js")?.text ?? "";
    expect([Array.from(text).length, text.includes("ghp_"), text.includes("A1b2C3d4")]).toEqual([
      200,
      false,
      false,
    ]);
  });

  test.skipIf(onWindows)(
    "by content with rg, the lines leave masked the same way (#829)",
    async () => {
      const { repo } = await setup();
      // A fake token and a fake key body line; neither is real.
      const token = `ghp_${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}`;
      const body = "MIIEowIBAAKCAQEAu1SU1LfVLPHCozMxH2Mo4lgOEePzNm0tRgeLezV6ffAt0gun";
      const rg = fakeRg(
        [
          event({ text: "./src/panel.ts" }, 1, { text: `const panelToken = "${token}";\n` }),
          event({ text: "./src/panel.ts" }, 2, { text: `  "${body}",\n` }),
        ].join("\n"),
      );
      const found = await searchRepository(
        repo,
        { mode: "content", query: "panel" },
        { rg: () => rg.path },
      );
      expect(found.matches.map((m) => m.text)).toEqual(['const [redacted]";', "[redacted]"]);
    },
  );

  test("a file named after a token is never listed, by name or by content (#829)", async () => {
    const { repo } = await setup();
    // A fake token of GitHub's shape in the file's name; the test never uses a real one.
    const named = `panel-ghp_${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}.txt`;
    writeFileSync(join(repo, "src", named), "panel\n");
    const leaks = async (mode: "name" | "content") =>
      (await searchRepository(repo, { mode, query: "panel" }, { rg: () => null })).matches.some(
        (m) => m.path.includes("ghp_"),
      );
    expect([await leaks("name"), await leaks("content")]).toEqual([false, false]);
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

  test("a folder that is no repository is refused by name and by content", async () => {
    const plain = tempDir("fd-plain-");
    writeFileSync(join(plain, "panel.ts"), "panel\n");
    expect([
      await failure(searchRepository(plain, { mode: "name", query: "panel" })),
      await failure(
        searchRepository(plain, { mode: "content", query: "panel" }, { rg: () => null }),
      ),
    ]).toEqual(["repo_not_git", "repo_not_git"]);
  });

  test("a search runs on a repository inside the allowed roots, never a terminal's folder or a session's elsewhere", async () => {
    const { changes, target, root, store } = await setup();
    const files = new ReviewFiles({ changes, dataDir: tempDir("fd-data-"), allowedRoots: [root] });
    // A session that ran in a repository outside the roots (an external one, the home's dotfiles).
    const elsewhere = join(tempDir("fd-elsewhere-"), "dotfiles");
    mkdirSync(elsewhere);
    Bun.spawnSync(["git", "init", "-q", elsewhere]);
    insertSession(store.db, "m-out", "s-out", elsewhere);
    const found = await files.search({ target, mode: "name", query: "panel.ts" }).catch(() => null);
    expect([
      found?.matches ?? null,
      await failure(files.search({ target: "terminal:t1", mode: "name", query: "x" })),
      await failure(files.search({ target: "session:s-out", mode: "content", query: "x" })),
    ]).toEqual([[{ path: "src/panel.ts" }], "review_target_invalid", "cwd_outside_roots"]);
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
