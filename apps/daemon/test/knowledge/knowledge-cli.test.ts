import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { fakeDaemon, type Handlers, project, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const HASH = "a".repeat(64);
const ADR = {
  path: "docs/adr/0001-queue.md",
  title: "Use a queue",
  type: "adr",
  status: "valid",
  supersedes: null,
  bytes: 1200,
  changedAt: "2026-11-01T10:00:00.000Z",
  problems: [],
  warnings: [],
  hash: HASH,
};
const OLD = {
  ...ADR,
  path: "docs/rfc/0002-old.md",
  title: "Old plan",
  type: null,
  status: "unclassified",
  supersedes: "docs/rfc/0001.md",
  problems: ["status_unknown"],
  warnings: ["references_obsolete:docs/adr/0000.md"],
};

const base = (over: Handlers = {}): Handlers => ({
  "project.list": () => ({ projects: [project("p1", "api")], maxParallelRuns: 2 }),
  "knowledge.list": () => ({ entries: [ADR, OLD], truncated: false }),
  "knowledge.index": () => ({
    text: "# Library\n- docs/adr/0001-queue.md",
    fed: 1,
    truncated: false,
  }),
  "knowledge.feed": () => ({ on: true, trusted: true, offBy: null, own: false }),
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

describe("flightdeckd knowledge list (issue #3623)", () => {
  test("a document is one line: path, status, type, title and the hash set-status takes; the request carries the project's folder", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["knowledge", "list", "api"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      `docs/adr/0001-queue.md  valid  adr  Use a queue  ${HASH}`,
      `docs/rfc/0002-old.md  unclassified  -  Old plan  ${HASH}  supersedes docs/rfc/0001.md  problems status_unknown  warnings references_obsolete:docs/adr/0000.md`,
    ]);
    expect(callsOf(daemon, "knowledge.list")).toEqual([{ path: "/w/api" }]);
  });

  test("a project is named by its id too, and an absolute folder goes to the daemon as it is", async () => {
    const daemon = fakeDaemon(base());
    await flightdeckd(["knowledge", "list", "p1"], daemon.port);
    await flightdeckd(["knowledge", "list", "/srv/other"], daemon.port);
    expect(callsOf(daemon, "knowledge.list")).toEqual([{ path: "/w/api" }, { path: "/srv/other" }]);
  });

  test("--json prints every key and the daemon's truncated flag", async () => {
    const daemon = fakeDaemon(
      base({ "knowledge.list": () => ({ entries: [OLD], truncated: true }) }),
    );
    const run = await flightdeckd(["knowledge", "list", "api", "--json"], daemon.port);
    expect(printed(run.out)).toEqual({ entries: [OLD], truncated: true });
  });

  test("a list cut short says so, and with none it says so", async () => {
    const cut = fakeDaemon(base({ "knowledge.list": () => ({ entries: [ADR], truncated: true }) }));
    const more = await flightdeckd(["knowledge", "list", "api"], cut.port);
    expect(more.out).toEqual([
      `docs/adr/0001-queue.md  valid  adr  Use a queue  ${HASH}`,
      "more documents than this list holds",
    ]);
    const none = fakeDaemon(base({ "knowledge.list": () => ({ entries: [], truncated: false }) }));
    const empty = await flightdeckd(["knowledge", "list", "api"], none.port);
    expect(empty.out).toEqual(["no knowledge documents"]);
  });

  test("a title from a file cannot drive the terminal", async () => {
    const hostile = { ...ADR, title: "evil\u001b[2J\u0007" };
    const daemon = fakeDaemon(
      base({ "knowledge.list": () => ({ entries: [hostile], truncated: false }) }),
    );
    const run = await flightdeckd(["knowledge", "list", "api"], daemon.port);
    const control = run.out.some((line) =>
      [...line].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
    );
    expect([run.out.length, control]).toEqual([1, false]);
  });

  test("a project that does not exist is refused, exit 1, and the library is not asked", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["knowledge", "list", "web"], daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([
      1,
      expect.stringContaining('no project named "web"'),
    ]);
    expect(callsOf(daemon, "knowledge.list")).toEqual([]);
  });

  test("a folder the host does not allow is the daemon's refusal, exit 1", async () => {
    const daemon = fakeDaemon(
      base({
        "knowledge.list": () => ({ error: { code: "forbidden", message: "folder not allowed" } }),
      }),
    );
    const run = await flightdeckd(["knowledge", "list", "api"], daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([1, expect.stringContaining("not allowed")]);
  });

  test("no daemon is exit 2", async () => {
    const daemon = fakeDaemon(base());
    const { port } = daemon;
    await stopAll();
    const run = await flightdeckd(["knowledge", "list", "api"], port);
    expect(run.code).toBe(2);
  });
});

describe("flightdeckd knowledge index (issue #3623)", () => {
  test("it prints the text a session is given, as it is, and nothing else", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["knowledge", "index", "api"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual(["# Library", "- docs/adr/0001-queue.md"]);
    expect(callsOf(daemon, "knowledge.index")).toEqual([{ path: "/w/api" }]);
  });

  test("--json prints the text, how many documents it names and whether some were left out", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["knowledge", "index", "api", "--json"], daemon.port);
    expect(printed(run.out)).toEqual({
      text: "# Library\n- docs/adr/0001-queue.md",
      fed: 1,
      truncated: false,
    });
  });

  test("an empty index says that no session is given a library", async () => {
    const daemon = fakeDaemon(
      base({ "knowledge.index": () => ({ text: "", fed: 0, truncated: false }) }),
    );
    const run = await flightdeckd(["knowledge", "index", "api"], daemon.port);
    expect(run.out).toEqual(["no document is given to sessions"]);
  });

  test("a text a file shaped cannot drive the terminal", async () => {
    const daemon = fakeDaemon(
      base({ "knowledge.index": () => ({ text: "a\u001b[2Jb", fed: 1, truncated: false }) }),
    );
    const run = await flightdeckd(["knowledge", "index", "api"], daemon.port);
    const control = run.out.some((line) => [...line].some((c) => c.charCodeAt(0) < 32));
    expect([run.code, control]).toEqual([0, false]);
  });
});

describe("flightdeckd knowledge feed (issue #3623)", () => {
  test("on: one line says so", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["knowledge", "feed", "api"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual(["on"]);
    expect(callsOf(daemon, "knowledge.feed")).toEqual([{ path: "/w/api" }]);
  });

  test("off by the project itself, off by a folder above it, and an untrusted project say why", async () => {
    const own = fakeDaemon(
      base({ "knowledge.feed": () => ({ on: false, trusted: true, offBy: "/w/api", own: true }) }),
    );
    expect((await flightdeckd(["knowledge", "feed", "api"], own.port)).out).toEqual([
      "off  switched off for /w/api (the project itself)",
    ]);
    const above = fakeDaemon(
      base({ "knowledge.feed": () => ({ on: false, trusted: true, offBy: "/w", own: false }) }),
    );
    expect((await flightdeckd(["knowledge", "feed", "api"], above.port)).out).toEqual([
      "off  switched off for /w (a folder above the project)",
    ]);
    const untrusted = fakeDaemon(
      base({ "knowledge.feed": () => ({ on: true, trusted: false, offBy: null, own: false }) }),
    );
    expect((await flightdeckd(["knowledge", "feed", "api"], untrusted.port)).out).toEqual([
      "on  but the project is not trusted, so sessions are not given the index",
    ]);
  });

  test("--json prints every key", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["knowledge", "feed", "api", "--json"], daemon.port);
    expect(printed(run.out)).toEqual({ on: true, trusted: true, offBy: null, own: false });
  });
});

describe("flightdeckd knowledge words and flags (issue #3623)", () => {
  test("each verb asks for the project, and an unknown verb is refused", () => {
    for (const verb of ["list", "index", "feed"])
      expect(() => parseArgs(["knowledge", verb])).toThrow("missing the project");
    expect(() => parseArgs(["knowledge", "frobnicate", "api"])).toThrow("invalid knowledge action");
    expect(() => parseArgs(["knowledge"])).toThrow("invalid knowledge action");
  });

  test("a read verb parses with --json and --host, and takes no other flag of the writes", () => {
    expect(() => parseArgs(["knowledge", "list", "api", "--json", "--host", "pi"])).not.toThrow();
    expect(parseArgs(["knowledge", "list", "api", "--json", "--host", "pi"])).toMatchObject({
      command: "knowledge",
      action: "list",
      json: true,
      host: "pi",
    });
    expect(() => parseArgs(["knowledge", "list", "api", "--confirm"])).toThrow("--confirm");
  });
});
