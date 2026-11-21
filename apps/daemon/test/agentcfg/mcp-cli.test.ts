import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { parseArgs } from "../../src/main.ts";
import { fakeDaemon, type Handlers, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);

afterEach(stopAll);

const PROJECT = { id: "p1", name: "api" };
const MASK = "••••••";
const FILES = {
  name: "files",
  origin: "project",
  readOnly: false,
  transport: "stdio",
  enabled: true,
  type: "stdio",
  command: "npx",
  args: ["-y", "files-server"],
  env: { API_KEY: MASK },
};
const DOCS = {
  name: "docs",
  origin: "user",
  readOnly: true,
  transport: "http",
  enabled: false,
  type: "http",
  url: "https://docs.example.com/mcp",
  headers: { Authorization: MASK },
};

const base = (over: Handlers = {}): Handlers => ({
  "project.list": () => ({ projects: [PROJECT], maxParallelRuns: 2 }),
  "mcp.list": () => ({ servers: [FILES, DOCS] }),
  "mcp.status": () => ({
    servers: [
      { name: "files", status: "connected" },
      { name: "docs", status: "needs-auth", error: "log in first" },
    ],
  }),
  "mcp.test": () => ({ preview: { command: "npx", args: ["-y", "files-server"] } }),
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

describe("flightdeckd mcp list (issue #3616)", () => {
  test("a server is one line: name, origin, transport, on or off, access, what it runs, and the names of its secrets", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["mcp", "list", "api"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "files  project  stdio  on  editable  npx -y files-server  env API_KEY",
      "docs  user  http  off  read-only  https://docs.example.com/mcp  headers Authorization",
    ]);
    expect(callsOf(daemon, "mcp.list")).toEqual([{ projectId: "p1" }]);
  });

  test("--json prints every key, null for what a server has none of, and the masked secrets as the daemon sends them", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["mcp", "list", "p1", "--json"], daemon.port);
    expect(run.code).toBe(0);
    const none = { type: null, command: null, args: null, env: null, url: null, headers: null };
    expect(printed(run.out)).toEqual({
      servers: [
        { ...none, ...FILES },
        { ...none, ...DOCS },
      ],
    });
  });

  test("a server with nothing to run has no empty column", async () => {
    const bare = { ...FILES, command: undefined, args: undefined, env: undefined };
    const daemon = fakeDaemon(base({ "mcp.list": () => ({ servers: [bare] }) }));
    const run = await flightdeckd(["mcp", "list", "api"], daemon.port);
    expect(run.out).toEqual(["files  project  stdio  on  editable"]);
  });

  test("with none it says so, and --json prints an empty list", async () => {
    const daemon = fakeDaemon(base({ "mcp.list": () => ({ servers: [] }) }));
    const text = await flightdeckd(["mcp", "list", "api"], daemon.port);
    expect(text.out).toEqual(["no MCP servers"]);
    const asJson = await flightdeckd(["mcp", "list", "api", "--json"], daemon.port);
    expect(printed(asJson.out)).toEqual({ servers: [] });
  });

  test("a name from a file cannot drive the terminal", async () => {
    const hostile = { ...FILES, name: "evil\u001b[2J", command: "a\u0007b" };
    const daemon = fakeDaemon(base({ "mcp.list": () => ({ servers: [hostile] }) }));
    const run = await flightdeckd(["mcp", "list", "api"], daemon.port);
    const control = run.out.some((line) =>
      [...line].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
    );
    expect([run.out.length, control]).toEqual([1, false]);
  });

  test("a project that does not exist is refused with exit 1 and nothing is listed", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["mcp", "list", "web"], daemon.port);
    expect(run.code).toBe(1);
    expect(run.err.join("\n")).toContain('no project named "web"');
    expect(callsOf(daemon, "mcp.list")).toEqual([]);
  });

  test("no daemon is exit 2", async () => {
    const daemon = fakeDaemon(base());
    const { port } = daemon;
    await stopAll();
    const run = await flightdeckd(["mcp", "list", "api"], port);
    expect(run.code).toBe(2);
  });
});

describe("flightdeckd mcp status (issue #3616)", () => {
  test("a server is one line: its name, the state its session reports, and its error when it has one", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["mcp", "status", "s1"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual(["files  connected", "docs  needs-auth  log in first"]);
    expect(callsOf(daemon, "mcp.status")).toEqual([{ sessionId: "s1" }]);
  });

  test("--json prints every key, null for a missing error", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["mcp", "status", "s1", "--json"], daemon.port);
    expect(printed(run.out)).toEqual({
      servers: [
        { name: "files", status: "connected", error: null },
        { name: "docs", status: "needs-auth", error: "log in first" },
      ],
    });
  });

  test("a session the daemon does not know is its refusal, exit 1", async () => {
    const daemon = fakeDaemon(
      base({
        "mcp.status": () => ({ error: { code: "not_found", message: "no such session: s9" } }),
      }),
    );
    const run = await flightdeckd(["mcp", "status", "s9"], daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([1, expect.stringContaining("no such session")]);
  });
});

describe("flightdeckd mcp test (issue #3616)", () => {
  test("it prints the command that would run and starts nothing: the request carries no confirm", async () => {
    const daemon = fakeDaemon(base());
    const run = await flightdeckd(["mcp", "test", "api", "files"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual(["would run: npx -y files-server"]);
    expect(callsOf(daemon, "mcp.test")).toEqual([{ projectId: "p1", name: "files" }]);
  });

  test("for an http server it prints the URL, and --json keeps every key of the preview", async () => {
    const daemon = fakeDaemon(base({ "mcp.test": () => ({ preview: { url: DOCS.url } }) }));
    const text = await flightdeckd(["mcp", "test", "api", "docs"], daemon.port);
    expect(text.out).toEqual(["would connect to: https://docs.example.com/mcp"]);
    const asJson = await flightdeckd(["mcp", "test", "api", "docs", "--json"], daemon.port);
    expect(printed(asJson.out)).toEqual({
      preview: { command: null, args: null, url: "https://docs.example.com/mcp" },
    });
  });

  test("a preview with nothing to run says so, and a daemon that started the server is refused", async () => {
    const empty = fakeDaemon(base({ "mcp.test": () => ({ preview: {} }) }));
    const none = await flightdeckd(["mcp", "test", "api", "files"], empty.port);
    expect([none.code, none.out]).toEqual([
      0,
      ["nothing to run: the server has no command and no link"],
    ]);
    const started = fakeDaemon(base({ "mcp.test": () => ({ tools: [], resources: [] }) }));
    const run = await flightdeckd(["mcp", "test", "api", "files"], started.port);
    expect([run.code, run.err.join("\n")]).toEqual([1, expect.stringContaining("only reads")]);
  });

  test("a server the project does not have is the daemon's refusal, exit 1", async () => {
    const daemon = fakeDaemon(
      base({ "mcp.test": () => ({ error: { code: "not_found", message: "no such server: x" } }) }),
    );
    const run = await flightdeckd(["mcp", "test", "api", "x"], daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([1, expect.stringContaining("no such server")]);
  });
});

describe("flightdeckd mcp words and flags (issue #3616)", () => {
  test("a bare `mcp` is still the stdio server, with its own flag", () => {
    expect(parseArgs(["mcp"])).toMatchObject({ command: "mcp" });
    expect(parseArgs(["mcp"]).action).toBeUndefined();
    expect(parseArgs(["mcp", "--config", "c.json"])).toMatchObject({
      command: "mcp",
      config: "c.json",
    });
  });

  test("a verb is never taken for a server flag: each one asks for its operand", () => {
    for (const verb of ["list", "status", "test"])
      expect(() => parseArgs(["mcp", verb])).toThrow("missing");
    expect(() => parseArgs(["mcp", "test", "api"])).toThrow("missing the server");
  });

  test("a word that is no verb, and the flags of the server's own run, are refused", () => {
    expect(() => parseArgs(["mcp", "frobnicate"])).toThrow("invalid mcp action");
    expect(() => parseArgs(["mcp", "--json"])).toThrow("--json");
    expect(() => parseArgs(["mcp", "--host", "box"])).toThrow("--host");
  });

  test("--confirm is not a flag of the read verbs: list and status refuse it", () => {
    expect(() => parseArgs(["mcp", "list", "api", "--confirm"])).toThrow("--confirm");
    expect(() => parseArgs(["mcp", "status", "s1", "--confirm"])).toThrow("--confirm");
  });
});
