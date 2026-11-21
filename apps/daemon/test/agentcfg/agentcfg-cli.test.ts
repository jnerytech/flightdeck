import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";
import { tempDir } from "../support/helpers.ts";

setDefaultTimeout(20_000);

const folders: string[] = [];
afterEach(async () => {
  await stopAll();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const PROJECT = { id: "p1", name: "api" };
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_NEW = "c".repeat(64);
const REVIEWER = {
  kind: "agent",
  path: ".claude/agents/reviewer.md",
  origin: "project",
  readOnly: false,
  hash: HASH_A,
  name: "reviewer",
  description: "Reviews diffs",
};
const HELPER = {
  kind: "agent",
  path: "agents/helper.md",
  origin: "user",
  readOnly: true,
  hash: HASH_B,
};
const CONTENT = "---\nname: reviewer\ndescription: Reviews diffs\n---\nBody";

const base = (over: Handlers = {}): Handlers => ({
  "project.list": () => ({ projects: [PROJECT], maxParallelRuns: 2 }),
  "agentcfg.list": () => ({ items: [REVIEWER, HELPER] }),
  "agentcfg.read": () => ({ ...REVIEWER, content: CONTENT }),
  "agentcfg.write": () => ({ hash: HASH_NEW }),
  ...over,
});

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

/** A file of content on disk, as a person keeps the next version of a CLAUDE.md. */
function contentFile(text: string): string {
  const folder = tempDir("agentcfg-cli-");
  folders.push(folder);
  const file = join(folder, "next.md");
  writeFileSync(file, text);
  return file;
}

/** What the command printed as JSON, or its text when it is none: a wrong print fails an assertion, not a parse. */
function printed(out: string[]): unknown {
  try {
    return JSON.parse(out.join("\n"));
  } catch {
    return out.join("\n");
  }
}

const stdin = (text: string) => ({ stdin: new Response(text).body as ReadableStream<Uint8Array> });
/** Whether a printed line holds a control character: only the line break between lines is allowed. */ const drivesTheTerminal =
  (lines: string[]) =>
    lines.some((line) => [...line].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127));

describe("flightdeckd agentcfg list (issue #3617)", () => {
  test("a file is one line: its path, origin, whether it can change, its hash, and its name and description when it has them", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["agentcfg", "list", "api", "--kind", "agent"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      `.claude/agents/reviewer.md  project  editable  ${HASH_A}  reviewer  Reviews diffs`,
      `agents/helper.md  user  read-only  ${HASH_B}`,
    ]);
    expect(callsOf(daemon, "agentcfg.list")).toEqual([{ projectId: "p1", kind: "agent" }]);
  });

  test("--json prints the items with every key and null for a missing name or description", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(
      ["agentcfg", "list", "p1", "--kind", "agent", "--json"],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({
      items: [REVIEWER, { ...HELPER, name: null, description: null }],
    });
  });

  test("with none it says so, and --json prints an empty list", async () => {
    const daemon = fakeDaemon(base({ "agentcfg.list": () => ({ items: [] }) }));
    const text = await flightdeckd(["agentcfg", "list", "api", "--kind", "skill"], daemon.port);
    expect(text.out.join("\n")).toContain("no skill files");
    const asJson = await flightdeckd(
      ["agentcfg", "list", "api", "--kind", "skill", "--json"],
      daemon.port,
    );
    expect(printed(asJson.out)).toEqual({ items: [] });
  });

  test("a name from a file cannot drive the terminal", async () => {
    const hostile = { ...REVIEWER, name: "evil\u001b[2J", description: "a\u0007b" };
    const daemon = fakeDaemon(base({ "agentcfg.list": () => ({ items: [hostile] }) }));
    const run = await flightdeckd(["agentcfg", "list", "api", "--kind", "agent"], daemon.port);
    expect([
      run.out.join("\n").includes("evil") || run.out.join("\n").includes("ok"),
      drivesTheTerminal(run.out),
    ]).toEqual([true, false]);
  });

  test("a project that does not exist is refused with exit 1 and nothing is listed", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["agentcfg", "list", "web", "--kind", "agent"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain('no project named "web"');
    expect(callsOf(daemon, "agentcfg.list")).toEqual([]);
  });

  test("no daemon is exit 2", async () => {
    const daemon = fakeDaemon(base());
    const { port } = daemon;
    await stopAll();
    const run = await flightdeckd(["agentcfg", "list", "api", "--kind", "agent"], port);
    expect(run.code).toBe(2);
  });

  test("a missing or wrong --kind, or a flag of another verb, is refused before anything is sent", async () => {
    const daemon = fakeDaemon(base());
    const missing = await flightdeckd(["agentcfg", "list", "api"], daemon.port);
    expect([missing.code, missing.err.join("\n")]).toEqual([1, expect.stringContaining("--kind")]);
    const wrong = await flightdeckd(["agentcfg", "list", "api", "--kind", "plugin"], daemon.port);
    expect([wrong.code, wrong.err.join("\n")]).toEqual([1, expect.stringContaining("--kind")]);
    const stray = await flightdeckd(
      ["agentcfg", "list", "api", "--kind", "agent", "--path", "x.md"],
      daemon.port,
    );
    expect([stray.code, stray.err.join("\n")]).toEqual([1, expect.stringContaining("--path")]);
    expect(daemon.calls.filter((c) => c.type.startsWith("agentcfg"))).toEqual([]);
  });
});

describe("flightdeckd agentcfg read (issue #3617)", () => {
  const argv = ["agentcfg", "read", "api", "--kind", "agent", "--path", REVIEWER.path];

  test("it prints the file's path, origin, hash and content, so the hash can be repeated on a write", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(argv, daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      ".claude/agents/reviewer.md  project  editable",
      `hash: ${HASH_A}`,
      "",
      "---",
      "name: reviewer",
      "description: Reviews diffs",
      "---",
      "Body",
    ]);
    expect(callsOf(daemon, "agentcfg.read")).toEqual([
      { projectId: "p1", kind: "agent", path: REVIEWER.path },
    ]);
  });

  test("--json keeps the content as it is, and --origin user is passed to the daemon", async () => {
    const daemon = fakeDaemon(base({ "agentcfg.read": () => ({ ...HELPER, content: "a\tb" }) }));
    const run = await flightdeckd(
      ["agentcfg", "read", "api", "--kind", "agent", "--path", "agents/helper.md"].concat([
        "--origin",
        "user",
        "--json",
      ]),
      daemon.port,
    );
    expect(printed(run.out)).toEqual({
      ...HELPER,
      name: null,
      description: null,
      content: "a\tb",
    });
    expect(callsOf(daemon, "agentcfg.read")).toEqual([
      { projectId: "p1", kind: "agent", path: "agents/helper.md", origin: "user" },
    ]);
  });

  test("a file's content cannot drive the terminal in the text form", async () => {
    const daemon = fakeDaemon(
      base({ "agentcfg.read": () => ({ ...REVIEWER, content: "ok\u001b]0;pwned\u0007" }) }),
    );
    const run = await flightdeckd(argv, daemon.port);
    expect([
      run.out.join("\n").includes("evil") || run.out.join("\n").includes("ok"),
      drivesTheTerminal(run.out),
    ]).toEqual([true, false]);
  });

  test("a file that is not there is the daemon's refusal, exit 1", async () => {
    const daemon = fakeDaemon(
      base({
        "agentcfg.read": () => ({
          error: { code: "invalid_state", message: "agentcfg_file_missing" },
        }),
      }),
    );
    const run = await flightdeckd(argv, daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("agentcfg_file_missing");
  });

  test("a read needs --path", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["agentcfg", "read", "api", "--kind", "agent"], daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([1, expect.stringContaining("--path")]);
    expect(callsOf(daemon, "agentcfg.read")).toEqual([]);
  });
});

describe("flightdeckd agentcfg write (issue #3617)", () => {
  const write = (...rest: string[]) => [
    "agentcfg",
    "write",
    "api",
    "--kind",
    "agent",
    "--path",
    REVIEWER.path,
    ...rest,
  ];

  test("it sends the file's content with the hash the person repeats and says what it wrote", async () => {
    const daemon = fakeDaemon(base());
    const file = contentFile(CONTENT);
    const run = await flightdeckd(
      write("--file", file, "--expected-hash", HASH_A, "--confirm"),
      daemon.port,
    );
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([`wrote ${REVIEWER.path} (agent)  hash: ${HASH_NEW}`]);
    expect(callsOf(daemon, "agentcfg.write")).toEqual([
      {
        projectId: "p1",
        kind: "agent",
        path: REVIEWER.path,
        content: CONTENT,
        expectedHash: HASH_A,
        confirm: true,
      },
    ]);
  });

  test("--new stands for a null hash, `--file -` reads the content from stdin, and --json prints the new hash", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(
      write("--file", "-", "--new", "--confirm", "--json"),
      daemon.port,
      undefined,
      stdin(CONTENT),
    );
    expect(run.code).toBe(0);
    expect(printed(run.out)).toEqual({
      kind: "agent",
      path: REVIEWER.path,
      hash: HASH_NEW,
    });
    expect(callsOf(daemon, "agentcfg.write")).toEqual([
      {
        projectId: "p1",
        kind: "agent",
        path: REVIEWER.path,
        content: CONTENT,
        expectedHash: null,
        confirm: true,
      },
    ]);
  });

  test("--origin user is passed on, and the daemon's refusal of it is printed as the daemon says it", async () => {
    const daemon = fakeDaemon(
      base({
        "agentcfg.write": () => ({
          error: { code: "invalid_state", message: "the user's files are read-only" },
        }),
      }),
    );
    const run = await flightdeckd(
      write(
        "--file",
        contentFile(CONTENT),
        "--expected-hash",
        HASH_A,
        "--confirm",
        "--origin",
        "user",
      ),
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("the user's files are read-only");
    expect(callsOf(daemon, "agentcfg.write")[0]?.origin).toBe("user");
  });

  test("a stale hash is the daemon's refusal, exit 1, and says nothing was written", async () => {
    const daemon = fakeDaemon(
      base({
        "agentcfg.write": () => ({ error: { code: "conflict", message: "agentcfg_changed" } }),
      }),
    );
    const run = await flightdeckd(
      write("--file", contentFile(CONTENT), "--expected-hash", HASH_B, "--confirm"),
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("agentcfg_changed");
    expect(run.err.join("\n")).not.toContain("may or may not");
  });

  test("a connection that closes after the write was sent says the file may or may not have changed", async () => {
    const daemon = fakeDaemon(base({ "agentcfg.write": () => CLOSE }));
    const run = await flightdeckd(
      write("--file", contentFile(CONTENT), "--expected-hash", HASH_A, "--confirm"),
      daemon.port,
    );
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not have changed");
  });

  test("without --confirm, or without the hash or --new, or with both, or without content, nothing is sent", async () => {
    const daemon = fakeDaemon(base());
    const file = contentFile(CONTENT);
    const runs = await Promise.all([
      flightdeckd(write("--file", file, "--expected-hash", HASH_A), daemon.port),
      flightdeckd(write("--file", file, "--confirm"), daemon.port),
      flightdeckd(
        write("--file", file, "--expected-hash", HASH_A, "--new", "--confirm"),
        daemon.port,
      ),
      flightdeckd(write("--expected-hash", HASH_A, "--confirm"), daemon.port),
    ]);
    expect(runs.map((r) => r.code)).toEqual([1, 1, 1, 1]);
    expect(runs.map((r) => r.err.join("\n"))).toEqual([
      expect.stringContaining("--confirm"),
      expect.stringContaining("--expected-hash"),
      expect.stringContaining("--new"),
      expect.stringContaining("--file"),
    ]);
    expect(callsOf(daemon, "agentcfg.write")).toEqual([]);
  });

  test("a content file that cannot be read is refused with exit 1 and nothing is sent", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(
      write("--file", "/nonexistent/next.md", "--new", "--confirm"),
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("/nonexistent/next.md");
    expect(callsOf(daemon, "agentcfg.write")).toEqual([]);
  });
});
