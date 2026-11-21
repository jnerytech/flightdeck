import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";
import { tempDir } from "../support/helpers.ts";

setDefaultTimeout(20_000);

const folders: string[] = [];
afterEach(async () => {
  await stopAll();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

const HASH_A = "a".repeat(64);
const HASH_NEW = "c".repeat(64);
const CONTENT = "---\ntype: feedback\n---\nnão é assim 🙂\r\nsecond line\n";

const base = (over: Handlers = {}): Handlers => ({
  "project.list": () => ({ projects: [{ id: "p1", name: "api" }], maxParallelRuns: 2 }),
  "memory.write": () => ({ hash: HASH_NEW }),
  "memory.delete": () => ({ name: "tdd.md" }),
  ...over,
});

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

/** A file of content on disk, as a person keeps the next version of a memory note. */
function contentFile(text: string): string {
  const folder = tempDir("memory-cli-");
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

const write = (...rest: string[]) => ["memory", "write", "api", "tdd.md", ...rest];
const remove = (...rest: string[]) => ["memory", "delete", "api", "tdd.md", ...rest];

describe("flightdeckd memory write (issue #3618)", () => {
  test("it sends the file's content with the hash the person repeats and says what it wrote", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(
      write("--file", contentFile(CONTENT), "--expected-hash", HASH_A, "--confirm"),
      daemon.port,
    );
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: [`wrote tdd.md  hash: ${HASH_NEW}`],
      err: [],
    });
    expect(callsOf(daemon, "memory.write")).toEqual([
      { projectId: "p1", name: "tdd.md", content: CONTENT, expectedHash: HASH_A, confirm: true },
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
    expect(printed(run.out)).toEqual({ name: "tdd.md", hash: HASH_NEW });
    expect(callsOf(daemon, "memory.write")).toEqual([
      { projectId: "p1", name: "tdd.md", content: CONTENT, expectedHash: null, confirm: true },
    ]);
  });

  test("an empty file is a write of empty content, not a refusal", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(
      write("--file", contentFile(""), "--new", "--confirm"),
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(callsOf(daemon, "memory.write")[0]).toMatchObject({ content: "" });
  });

  test("a stale hash is the daemon's refusal with its reason, exit 1, and says nothing was written", async () => {
    const daemon = fakeDaemon(
      base({
        "memory.write": () => ({
          error: { code: "memory_changed", message: "tdd.md changed since it was opened" },
        }),
      }),
    );
    const run = await flightdeckd(
      write("--file", contentFile(CONTENT), "--expected-hash", HASH_A, "--confirm"),
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("tdd.md changed since it was opened");
    expect(run.err.join("\n")).not.toContain("may or may not");
  });

  test("--new on a file that exists is the daemon's refusal, exit 1", async () => {
    const daemon = fakeDaemon(
      base({
        "memory.write": () => ({
          error: { code: "memory_exists", message: "tdd.md already exists" },
        }),
      }),
    );
    const run = await flightdeckd(
      write("--file", contentFile(CONTENT), "--new", "--confirm"),
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("tdd.md already exists");
  });

  test("a name the daemon refuses, a link or an invalid one, is its text and exit 1", async () => {
    const daemon = fakeDaemon(
      base({
        "memory.write": () => ({
          error: { code: "memory_is_link", message: "tdd.md is a link" },
        }),
      }),
    );
    const run = await flightdeckd(
      write("--file", contentFile(CONTENT), "--new", "--confirm"),
      daemon.port,
    );
    expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
    expect(run.err.join("\n")).toContain("tdd.md is a link");
  });

  test("a connection that closes after the write was sent says the file may or may not have changed", async () => {
    const daemon = fakeDaemon(base({ "memory.write": () => CLOSE }));
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
      expect.stringContaining("memory write: needs --confirm"),
      expect.stringContaining("memory write: missing --expected-hash"),
      expect.stringContaining("--expected-hash and --new cannot go together"),
      expect.stringContaining("memory write: missing --file"),
    ]);
    expect(callsOf(daemon, "memory.write")).toEqual([]);
  });

  test("a hash that is not 64 hex digits is refused and nothing is sent", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(
      write("--file", contentFile(CONTENT), "--expected-hash", "abc", "--confirm"),
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("--expected-hash: a sha256 hash of 64 hex digits");
    expect(callsOf(daemon, "memory.write")).toEqual([]);
  });

  test("a content file that cannot be read is refused with exit 1 and nothing is sent", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(
      write("--file", "/nonexistent/next.md", "--new", "--confirm"),
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("/nonexistent/next.md");
    expect(callsOf(daemon, "memory.write")).toEqual([]);
  });

  test("an unknown project is refused before the write is sent", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(
      ["memory", "write", "nope", "tdd.md", "--file", contentFile(CONTENT), "--new", "--confirm"],
      daemon.port,
    );
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain("nope");
    expect(callsOf(daemon, "memory.write")).toEqual([]);
  });
});

describe("flightdeckd memory delete (issue #3618)", () => {
  test("it sends the hash the person repeats and says what it deleted", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(remove("--expected-hash", HASH_A, "--confirm"), daemon.port);
    expect({ code: run.code, out: run.out, err: run.err }).toEqual({
      code: 0,
      out: ["deleted tdd.md"],
      err: [],
    });
    expect(callsOf(daemon, "memory.delete")).toEqual([
      { projectId: "p1", name: "tdd.md", expectedHash: HASH_A, confirm: true },
    ]);
  });

  test("--json prints the name that was deleted", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(
      remove("--expected-hash", HASH_A, "--confirm", "--json"),
      daemon.port,
    );
    expect(printed(run.out)).toEqual({ name: "tdd.md" });
  });

  test("a file that is not there, or that changed, is the daemon's text and exit 1", async () => {
    for (const [code, message] of [
      ["memory_not_found", "no memory file tdd.md"],
      ["memory_changed", "tdd.md changed since it was opened"],
    ] as const) {
      const daemon = fakeDaemon(base({ "memory.delete": () => ({ error: { code, message } }) }));
      const run = await flightdeckd(remove("--expected-hash", HASH_A, "--confirm"), daemon.port);
      expect({ code: run.code, out: run.out }).toEqual({ code: 1, out: [] });
      expect(run.err.join("\n")).toContain(message);
      expect(run.err.join("\n")).not.toContain("may or may not");
      await stopAll();
    }
  });

  test("a connection that closes after the delete was sent says the file may or may not have changed", async () => {
    const daemon = fakeDaemon(base({ "memory.delete": () => CLOSE }));
    const run = await flightdeckd(remove("--expected-hash", HASH_A, "--confirm"), daemon.port);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("may or may not have changed");
  });

  test("without --confirm or without the hash, or with a content flag, nothing is sent", async () => {
    const daemon = fakeDaemon(base());
    const runs = await Promise.all([
      flightdeckd(remove("--expected-hash", HASH_A), daemon.port),
      flightdeckd(remove("--confirm"), daemon.port),
      flightdeckd(remove("--new", "--confirm"), daemon.port),
      flightdeckd(
        remove("--expected-hash", HASH_A, "--file", contentFile(CONTENT), "--confirm"),
        daemon.port,
      ),
    ]);
    expect(runs.map((r) => r.code)).toEqual([1, 1, 1, 1]);
    expect(runs.map((r) => r.err.join("\n"))).toEqual([
      expect.stringContaining("memory delete: needs --confirm"),
      expect.stringContaining("memory delete: missing --expected-hash"),
      expect.stringContaining("--new: on memory this flag only applies to write"),
      expect.stringContaining("--file: on memory this flag only applies to write"),
    ]);
    expect(callsOf(daemon, "memory.delete")).toEqual([]);
  });
});

describe("flightdeckd memory write and delete arguments (issue #3618)", () => {
  test("write takes the project, the name, the content, the hash or --new, and --confirm", () => {
    expect(
      parseArgs(["memory", "write", "api", "tdd.md", "--file", "-", "--new", "--confirm"]),
    ).toMatchObject({
      command: "memory",
      action: "write",
      memoryProject: "api",
      memoryName: "tdd.md",
      confirm: true,
    });
  });

  test("delete takes the project, the name, the hash and --confirm", () => {
    expect(
      parseArgs(["memory", "delete", "api", "tdd.md", "--expected-hash", HASH_A, "--confirm"]),
    ).toMatchObject({ command: "memory", action: "delete", memoryName: "tdd.md", confirm: true });
  });

  test("a write or delete with no file name is refused", () => {
    for (const action of ["write", "delete"])
      expect(() => parseArgs(["memory", action, "api"])).toThrow("the file name");
  });

  test("--kind and --path, which are agentcfg's, stay refused on every memory verb", () => {
    for (const flag of [
      ["--kind", "x"],
      ["--path", "x"],
    ])
      for (const verb of [
        ["list", "api"],
        ["read", "api", "tdd.md"],
        ["suggest", "api"],
      ])
        expect(() => parseArgs(["memory", ...verb, ...flag])).toThrow("agentcfg");
  });

  test("--confirm, --file, --expected-hash and --new are refused on a verb that does not write", () => {
    for (const flag of [["--confirm"], ["--file", "x"], ["--expected-hash", HASH_A], ["--new"]])
      for (const verb of [
        ["list", "api"],
        ["read", "api", "tdd.md"],
        ["budget", "api"],
      ])
        expect(() => parseArgs(["memory", ...verb, ...flag])).toThrow(
          "on memory this flag only applies to",
        );
  });
});
