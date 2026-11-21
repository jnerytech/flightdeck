import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { CLOSE, fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const PROJECT = { id: "p1", name: "api" };
const H1 = "a".repeat(64);
const H2 = "b".repeat(64);
const INDEX = { name: "MEMORY.md", hash: H1, bytes: 120, lines: 4, inIndex: true };
const TOPIC = {
  name: "tdd.md",
  hash: H2,
  bytes: 2048,
  lines: 30,
  type: "feedback",
  description: "red before green",
  inIndex: false,
};
const LISTING = { dir: "/home/u/.claude/projects/api/memory", exists: true, files: [INDEX, TOPIC] };
const BUDGET = {
  sources: [{ kind: "memory", path: "MEMORY.md", bytes: 120, tokens: 30, load: "start" }],
  startTokens: 1234,
  memory: {
    limitLines: 200,
    limitBytes: 25_000,
    indexLines: 250,
    indexBytes: 9000,
    loadedLines: 200,
    loadedBytes: 7000,
    cutBy: "lines",
    leftOutLines: ["- [Late](late.md) — added last"],
    leftOutFiles: ["late.md"],
  },
};

const base = (over: Handlers = {}): Handlers => ({
  "project.list": () => ({ projects: [PROJECT], maxParallelRuns: 2 }),
  "memory.list": () => LISTING,
  "memory.read": () => ({ ...TOPIC, content: "line one\nline two" }),
  "memory.budget": () => BUDGET,
  "memory.suggest": () => ({
    suggestions: [
      { kind: "broken-link", files: ["MEMORY.md"], detail: "- [Gone](gone.md) — x" },
      { kind: "duplicate", files: ["a.md", "b.md"] },
    ],
  }),
  ...over,
});

const callsOf = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type).map((c) => c.payload);

/** What the command printed as JSON, or its text when it is none: a wrong print fails an assertion, not a parse. */
function printed(out: string[]): unknown {
  try {
    return JSON.parse(out.join("\n"));
  } catch {
    return out.join("\n");
  }
}

const run = async (argv: string[], handlers: Handlers = base()) => {
  const daemon = fakeDaemon(handlers);
  const ran = await flightdeckd(["memory", ...argv], daemon.port);
  return { daemon, ...ran };
};

describe("flightdeckd memory list (issue #3618)", () => {
  test("each file is a line with its name, hash, size, whether the index names it, and its type and description", async () => {
    const r = await run(["list", "api"]);
    expect({ code: r.code, out: r.out, err: r.err }).toEqual({
      code: 0,
      out: [
        `MEMORY.md  ${H1}  120 bytes  4 lines  in index`,
        `tdd.md  ${H2}  2048 bytes  30 lines  not in index  feedback  red before green`,
      ],
      err: [],
    });
    expect(callsOf(r.daemon, "memory.list")).toEqual([{ projectId: "p1" }]);
  });

  test("a project is named by id or by name, and an unknown one is refused with exit 1", async () => {
    expect((await run(["list", "p1"])).code).toBe(0);
    const unknown = await run(["list", "nope"]);
    expect({ code: unknown.code, out: unknown.out }).toEqual({ code: 1, out: [] });
    expect(unknown.err.join("\n")).toContain("nope");
    expect(callsOf(unknown.daemon, "memory.list")).toEqual([]);
  });

  test("a project with no memory folder says so and exits 0", async () => {
    const r = await run(
      ["list", "api"],
      base({ "memory.list": () => ({ dir: "/m", exists: false, files: [] }) }),
    );
    expect({ code: r.code, out: r.out }).toEqual({ code: 0, out: ["no memory folder: /m"] });
  });

  test("a memory folder with no file says so and exits 0", async () => {
    const r = await run(
      ["list", "api"],
      base({ "memory.list": () => ({ dir: "/m", exists: true, files: [] }) }),
    );
    expect({ code: r.code, out: r.out }).toEqual({ code: 0, out: ["no memory files in /m"] });
  });

  test("--json keeps every key and prints null where a file has no type or description", async () => {
    const r = await run(["list", "api", "--json"]);
    expect(r.code).toBe(0);
    expect(printed(r.out)).toEqual({
      dir: LISTING.dir,
      exists: true,
      files: [{ ...INDEX, type: null, description: null }, { ...TOPIC }],
    });
  });

  test("a file name that carries a control character cannot drive the terminal", async () => {
    const r = await run(
      ["list", "api"],
      base({
        "memory.list": () => ({ ...LISTING, files: [{ ...INDEX, name: "a\u001b[2Jb.md" }] }),
      }),
    );
    expect(r.out.join("\n")).toContain("b.md");
    expect(r.out.join("\n").includes("\u001b")).toBe(false);
  });
});

describe("flightdeckd memory read (issue #3618)", () => {
  test("it prints the file's identity and hash, a blank line, then its content line by line", async () => {
    const r = await run(["read", "api", "tdd.md"]);
    expect({ code: r.code, out: r.out }).toEqual({
      code: 0,
      out: [
        `tdd.md  2048 bytes  30 lines  not in index  feedback  red before green`,
        `hash: ${H2}`,
        "",
        "line one",
        "line two",
      ],
    });
    expect(callsOf(r.daemon, "memory.read")).toEqual([{ projectId: "p1", name: "tdd.md" }]);
  });

  test("--json prints the file with its content and null for what it has none of", async () => {
    const r = await run(
      ["read", "api", "MEMORY.md", "--json"],
      base({ "memory.read": () => ({ ...INDEX, content: "- [TDD](tdd.md)" }) }),
    );
    expect(printed(r.out)).toEqual({
      ...INDEX,
      type: null,
      description: null,
      content: "- [TDD](tdd.md)",
    });
  });

  test("a name the daemon refuses is its text on stderr and exit 1", async () => {
    const r = await run(
      ["read", "api", "../x"],
      base({
        "memory.read": () => ({
          error: {
            code: "memory_name_invalid",
            message: "a memory file name is a plain file name",
          },
        }),
      }),
    );
    expect({ code: r.code, out: r.out }).toEqual({ code: 1, out: [] });
    expect(r.err.join("\n")).toContain("a memory file name is a plain file name");
    expect(callsOf(r.daemon, "memory.read")).toEqual([{ projectId: "p1", name: "../x" }]);
  });

  test("a file that is not there is exit 1 with the daemon's text", async () => {
    const r = await run(
      ["read", "api", "gone.md"],
      base({
        "memory.read": () => ({
          error: { code: "memory_not_found", message: "no memory file gone.md" },
        }),
      }),
    );
    expect({ code: r.code, err: r.err }).toEqual({
      code: 1,
      err: ["flightdeckd: memory_not_found: no memory file gone.md"],
    });
  });

  test("content with accents, emoji and a CRLF is printed as lines, and an escape cannot drive the terminal", async () => {
    const r = await run(
      ["read", "api", "tdd.md"],
      base({ "memory.read": () => ({ ...TOPIC, content: "não é assim 🙂\r\n\u001b[2Jwiped" }) }),
    );
    expect(r.out.slice(3)).toEqual(["não é assim 🙂", " [2Jwiped"]);
  });
});

describe("flightdeckd memory budget (issue #3618)", () => {
  test("it prints what the memory costs at the start, the index against its limits, what cut it and what was left out", async () => {
    const r = await run(["budget", "api"]);
    expect({ code: r.code, out: r.out }).toEqual({
      code: 0,
      out: [
        "start of a session: 1234 tokens",
        "index: 250 lines of 200, 9000 bytes of 25000",
        "loaded: 200 lines, 7000 bytes, cut by lines",
        "left out of the index: - [Late](late.md) — added last",
        "left out files: late.md",
      ],
    });
    expect(callsOf(r.daemon, "memory.budget")).toEqual([{ projectId: "p1" }]);
  });

  test("an index that fits says all of it loads and lists nothing left out", async () => {
    const fits = {
      ...BUDGET,
      memory: {
        ...BUDGET.memory,
        indexLines: 4,
        indexBytes: 120,
        loadedLines: 4,
        loadedBytes: 120,
        cutBy: null,
        leftOutLines: [],
        leftOutFiles: [],
      },
    };
    const r = await run(["budget", "api"], base({ "memory.budget": () => fits }));
    expect(r.out).toEqual([
      "start of a session: 1234 tokens",
      "index: 4 lines of 200, 120 bytes of 25000",
      "loaded: 4 lines, 120 bytes, all of it",
    ]);
  });

  test("--json prints the budget as the daemon sends it, with cutBy null when all of it fits", async () => {
    const fits = { ...BUDGET, memory: { ...BUDGET.memory, cutBy: null } };
    const r = await run(["budget", "api", "--json"], base({ "memory.budget": () => fits }));
    expect(printed(r.out)).toEqual(fits);
  });
});

describe("flightdeckd memory suggest (issue #3618)", () => {
  test("each suggestion is a line with its kind and files, and the index line behind a broken link", async () => {
    const r = await run(["suggest", "api"]);
    expect({ code: r.code, out: r.out }).toEqual({
      code: 0,
      out: ["broken-link  MEMORY.md  - [Gone](gone.md) — x", "duplicate  a.md, b.md"],
    });
    expect(callsOf(r.daemon, "memory.suggest")).toEqual([{ projectId: "p1" }]);
  });

  test("no suggestion says so and exits 0", async () => {
    const r = await run(
      ["suggest", "api"],
      base({ "memory.suggest": () => ({ suggestions: [] }) }),
    );
    expect({ code: r.code, out: r.out }).toEqual({ code: 0, out: ["no suggestions"] });
  });

  test("--json prints null for the detail a suggestion has none of", async () => {
    const r = await run(["suggest", "api", "--json"]);
    expect(printed(r.out)).toEqual({
      suggestions: [
        { kind: "broken-link", files: ["MEMORY.md"], detail: "- [Gone](gone.md) — x" },
        { kind: "duplicate", files: ["a.md", "b.md"], detail: null },
      ],
    });
  });

  test("it only reads: the daemon is never asked to write or delete", async () => {
    const r = await run(["suggest", "api"]);
    expect(r.daemon.calls.map((c) => c.type).filter((t) => /write|delete/.test(t))).toEqual([]);
  });
});

describe("flightdeckd memory when the daemon is not there (issue #3618)", () => {
  test("a daemon that closes the connection is exit 2", async () => {
    const r = await run(["list", "api"], base({ "memory.list": () => CLOSE }));
    expect(r.code).toBe(2);
  });

  test("no daemon at all is exit 2", async () => {
    expect((await flightdeckd(["memory", "list", "api"], 1)).code).toBe(2);
  });
});

describe("flightdeckd memory arguments (issue #3618)", () => {
  test("list, budget and suggest take the project, --json and --host", () => {
    for (const action of ["list", "budget", "suggest"])
      expect(parseArgs(["memory", action, "api", "--json", "--host", "pi"])).toMatchObject({
        command: "memory",
        action,
        memoryProject: "api",
        json: true,
        host: "pi",
      });
  });

  test("read takes the project and the file name", () => {
    expect(parseArgs(["memory", "read", "api", "tdd.md"])).toMatchObject({
      command: "memory",
      action: "read",
      memoryProject: "api",
      memoryName: "tdd.md",
    });
  });

  test("a verb with no project is refused", () => {
    for (const action of ["list", "read", "budget", "suggest"])
      expect(() => parseArgs(["memory", action])).toThrow("the project");
  });

  test("read with no file name is refused", () => {
    expect(() => parseArgs(["memory", "read", "api"])).toThrow("the file name");
  });

  test("a second word on a verb that takes only the project is refused", () => {
    expect(() => parseArgs(["memory", "list", "api", "extra"])).toThrow("extra");
  });

  test("an unknown memory action is refused", () => {
    expect(() => parseArgs(["memory", "frobnicate"])).toThrow("invalid memory action");
  });
});
