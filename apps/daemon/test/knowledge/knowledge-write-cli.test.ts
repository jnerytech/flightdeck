import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runKnowledgeCli } from "../../src/knowledge/index.ts";
import { parseArgs } from "../../src/main.ts";
import { config, fakeDaemon, type Handlers, project, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const dir = mkdtempSync(join(tmpdir(), "knowledge-write-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const HASH = "b".repeat(64);
const ADR = {
  path: "docs/adr/0001-queue.md",
  title: "Use a queue",
  type: "adr",
  status: "obsolete",
  supersedes: null,
  bytes: 1200,
  changedAt: "2026-11-01T10:00:00.000Z",
  problems: [],
  warnings: [],
  hash: HASH,
};
const LINE = `docs/adr/0001-queue.md  obsolete  adr  Use a queue  ${HASH}`;

const base = (over: Handlers = {}): Handlers => ({
  "project.list": () => ({ projects: [project("p1", "api")], maxParallelRuns: 2 }),
  "knowledge.setStatus": () => ADR,
  "knowledge.create": () => ({ ...ADR, status: "unclassified" }),
  "knowledge.setFeed": () => ({ on: false, trusted: true, offBy: "/w/api", own: true }),
  ...over,
});

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

const printed = (out: string[]): unknown => {
  try {
    return JSON.parse(out.join("\n"));
  } catch {
    return out.join("\n");
  }
};

const refused = (argv: string[]): string => {
  try {
    parseArgs(argv);
    return "";
  } catch (error) {
    return (error as Error).message;
  }
};

describe("flightdeckd knowledge set-status (issue #3623)", () => {
  test("it writes the status the person names for the hash the list showed, and prints the document", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(
      [
        "knowledge",
        "set-status",
        "api",
        "docs/adr/0001-queue.md",
        "--status",
        "obsolete",
        "--hash",
        HASH,
      ],
      daemon.port,
    );
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([LINE]);
    expect(callsOf(daemon, "knowledge.setStatus")).toEqual([
      { path: "/w/api", file: "docs/adr/0001-queue.md", status: "obsolete", expectedHash: HASH },
    ]);
  });

  test("the command never reads the hash itself: no list is asked for", async () => {
    const daemon = fakeDaemon(base());
    await flightdeckd(
      [
        "knowledge",
        "set-status",
        "api",
        "docs/adr/0001-queue.md",
        "--status",
        "valid",
        "--hash",
        HASH,
      ],
      daemon.port,
    );
    expect(callsOf(daemon, "knowledge.list")).toEqual([]);
  });

  test("--json prints the document with every key", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(
      [
        "knowledge",
        "set-status",
        "api",
        "docs/adr/0001-queue.md",
        "--status",
        "obsolete",
        "--hash",
        HASH,
        "--json",
      ],
      daemon.port,
    );
    expect(printed(run.out)).toEqual(ADR);
  });

  test("a file that changed since it was listed is the daemon's refusal, exit 1", async () => {
    const daemon = fakeDaemon(
      base({
        "knowledge.setStatus": () => ({
          error: { code: "file_conflict", message: "the file changed since it was listed" },
        }),
      }),
    );
    const run = await flightdeckd(
      [
        "knowledge",
        "set-status",
        "api",
        "docs/adr/0001-queue.md",
        "--status",
        "obsolete",
        "--hash",
        HASH,
      ],
      daemon.port,
    );
    expect([run.code, run.err.join("\n")]).toEqual([1, expect.stringContaining("changed")]);
  });

  test("an answer that never comes is exit 2, and it says to look before trying again", async () => {
    const silent = fakeDaemon({
      "project.list": () => ({ projects: [project("p1", "api")], maxParallelRuns: 2 }),
    });
    const result = await runKnowledgeCli(
      { action: "set-status", project: "p1", file: "a.md", status: "obsolete", hash: HASH },
      config(silent.port),
      { timeoutMs: 200 },
    );
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).toContain("may or may not have");
    expect(result.err.join("\n")).toContain("knowledge list");
  });
});

describe("flightdeckd knowledge create (issue #3623)", () => {
  test("a title and a kind make a document from the template, and the request carries no body", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(
      ["knowledge", "create", "api", "adr", "Use a queue"],
      daemon.port,
    );
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([`docs/adr/0001-queue.md  unclassified  adr  Use a queue  ${HASH}`]);
    expect(callsOf(daemon, "knowledge.create")).toEqual([
      { path: "/w/api", kind: "adr", title: "Use a queue" },
    ]);
  });

  test("--body-file sends the file's text under the heading", async () => {
    const file = join(dir, "draft.md");
    writeFileSync(file, "## Context\nWe need one.\n");
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(
      ["knowledge", "create", "api", "rfc", "Queue", "--body-file", file],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(callsOf(daemon, "knowledge.create")).toEqual([
      { path: "/w/api", kind: "rfc", title: "Queue", body: "## Context\nWe need one.\n" },
    ]);
  });

  test("--json prints the new document", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(
      ["knowledge", "create", "api", "adr", "Use a queue", "--json"],
      daemon.port,
    );
    expect(printed(run.out)).toEqual({ ...ADR, status: "unclassified" });
  });

  test("a body file that cannot be read, or holds more than the daemon takes, is refused before the daemon is asked", async () => {
    const daemon = fakeDaemon(base());
    const missing = await flightdeckd(
      ["knowledge", "create", "api", "adr", "T", "--body-file", join(dir, "nope.md")],
      daemon.port,
    );
    expect([missing.code, missing.err.join("\n")]).toEqual([
      1,
      expect.stringContaining("cannot read the body file"),
    ]);
    const big = join(dir, "big.md");
    writeFileSync(big, "x".repeat(100_001));
    const long = await flightdeckd(
      ["knowledge", "create", "api", "adr", "T", "--body-file", big],
      daemon.port,
    );
    expect([long.code, long.err.join("\n")]).toEqual([1, expect.stringContaining("100000")]);
    expect(callsOf(daemon, "knowledge.create")).toEqual([]);
  });

  test("a document that already exists, a title with no letter and an unsafe folder are the daemon's refusals, exit 1", async () => {
    for (const [code, message] of [
      ["file_conflict", "docs/adr/0001-queue.md already exists"],
      ["bad_request", "the title has no letter or digit"],
      ["forbidden", "the folder is a link that leaves the project"],
    ] as const) {
      const daemon = fakeDaemon(base({ "knowledge.create": () => ({ error: { code, message } }) }));
      const run = await flightdeckd(["knowledge", "create", "api", "adr", "T"], daemon.port);
      expect([run.code, run.err.join("\n")]).toEqual([1, expect.stringContaining(message)]);
    }
  });
});

describe("flightdeckd knowledge set-feed (issue #3623)", () => {
  test("--off switches the index off for the project and prints where it stands", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["knowledge", "set-feed", "api", "--off"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual(["off  switched off for /w/api (the project itself)"]);
    expect(callsOf(daemon, "knowledge.setFeed")).toEqual([{ path: "/w/api", enabled: false }]);
  });

  test("--on switches it on, and --json prints the state", async () => {
    const daemon = fakeDaemon(
      base({ "knowledge.setFeed": () => ({ on: true, trusted: true, offBy: null, own: false }) }),
    );
    const run = await flightdeckd(["knowledge", "set-feed", "api", "--on", "--json"], daemon.port);
    expect(printed(run.out)).toEqual({ on: true, trusted: true, offBy: null, own: false });
    expect(callsOf(daemon, "knowledge.setFeed")).toEqual([{ path: "/w/api", enabled: true }]);
  });
});

describe("flightdeckd knowledge write words and flags (issue #3623)", () => {
  test("each write verb parses with its flags", () => {
    expect(() =>
      parseArgs(["knowledge", "set-status", "api", "a.md", "--status", "valid", "--hash", HASH]),
    ).not.toThrow();
    expect(() => parseArgs(["knowledge", "create", "api", "adr", "T"])).not.toThrow();
    expect(() => parseArgs(["knowledge", "set-feed", "api", "--on"])).not.toThrow();
  });

  test("set-status needs the file, a status the library knows and the hash", () => {
    expect(refused(["knowledge", "set-status", "api"])).toContain("missing the file");
    expect(refused(["knowledge", "set-status", "api", "a.md", "--hash", HASH])).toContain(
      "needs --status",
    );
    expect(refused(["knowledge", "set-status", "api", "a.md", "--status", "valid"])).toContain(
      "needs --hash",
    );
    expect(
      refused(["knowledge", "set-status", "api", "a.md", "--status", "archived", "--hash", HASH]),
    ).toContain("--status");
  });

  test("create needs a kind the templates have and a title", () => {
    expect(refused(["knowledge", "create", "api"])).toContain("missing the kind");
    expect(refused(["knowledge", "create", "api", "spec", "T"])).toContain("adr, rfc, prd");
    expect(refused(["knowledge", "create", "api", "adr"])).toContain("missing the title");
  });

  test("set-feed names one direction", () => {
    expect(refused(["knowledge", "set-feed", "api"])).toContain("--on or --off");
    expect(refused(["knowledge", "set-feed", "api", "--on", "--off"])).toContain("not both");
  });

  test("a flag belongs to its verbs, and the reads take none of them", () => {
    expect(refused(["knowledge", "list", "api", "--status", "valid"])).toContain(
      "--status: this flag only applies to flightdeckd knowledge set-status",
    );
    expect(refused(["knowledge", "list", "api", "--on"])).toContain(
      "this flag only applies to flightdeckd knowledge set-feed",
    );
    expect(refused(["knowledge", "feed", "api", "--hash", HASH])).toContain(
      "--hash: this flag only applies to flightdeckd knowledge set-status",
    );
    expect(refused(["knowledge", "set-feed", "api", "--on", "--body-file", "f.md"])).toContain(
      "--body-file: this flag only applies to flightdeckd knowledge create",
    );
    expect(refused(["knowledge", "create", "api", "adr", "T", "--confirm"])).toContain("--confirm");
  });

  test("the other commands keep their own --status, --on and --hash", () => {
    expect(parseArgs(["message", "history", "--status", "delivered"])).toMatchObject({
      command: "message",
    });
    expect(parseArgs(["boardsync", "set-push", "api", "--on"])).toMatchObject({
      command: "boardsync",
      boardsyncPush: true,
    });
  });
});
