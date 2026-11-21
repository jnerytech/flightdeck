import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { runMcpCli } from "../../src/agentcfg/index.ts";
import { parseArgs } from "../../src/main.ts";
import { config, fakeDaemon, type Handlers, project, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const FILES = {
  name: "files",
  origin: "project",
  readOnly: false,
  transport: "stdio",
  enabled: true,
  type: "stdio",
  command: "npx",
  args: ["-y", "files-server"],
};
const DOCS = { ...FILES, name: "docs", enabled: false };

const OPEN: Handlers = {
  "project.list": () => ({ projects: [project("p1", "api")], maxParallelRuns: 2 }),
  "mcp.test": () => ({ tools: ["read_file", "write_file"], resources: [] }),
  "mcp.remove": () => ({ servers: [DOCS] }),
  "mcp.toggle": () => ({ servers: [{ ...FILES, enabled: false }, DOCS] }),
};

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

describe("flightdeckd mcp test --confirm (issue #3616)", () => {
  test("it asks the daemon to start the server and prints what the server offers; the request carries confirm", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["mcp", "test", "api", "files", "--confirm"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual(["tools: read_file, write_file", "resources: none"]);
    expect(callsOf(daemon, "mcp.test")).toEqual([
      { projectId: "p1", name: "files", confirm: true },
    ]);
  });

  test("--json prints both lists", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["mcp", "test", "p1", "files", "--confirm", "--json"],
      daemon.port,
    );
    expect(printed(run.out)).toEqual({ tools: ["read_file", "write_file"], resources: [] });
  });

  test("a daemon that only answers a preview to a confirmed test is refused, exit 1", async () => {
    const daemon = fakeDaemon({ ...OPEN, "mcp.test": () => ({ preview: { command: "npx" } }) });
    const run = await flightdeckd(["mcp", "test", "api", "files", "--confirm"], daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([1, expect.stringContaining("did not start")]);
  });

  test("a server that fails to start is the daemon's refusal, exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "mcp.test": () => ({ error: { code: "internal", message: "spawn npx ENOENT" } }),
    });
    const run = await flightdeckd(["mcp", "test", "api", "files", "--confirm"], daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([1, expect.stringContaining("ENOENT")]);
  });
});

describe("flightdeckd mcp remove (issue #3616)", () => {
  test("it removes the server from the project and prints what is left; the request carries confirm", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["mcp", "remove", "api", "files", "--confirm"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "removed files",
      "docs  project  stdio  off  editable  npx -y files-server",
    ]);
    expect(callsOf(daemon, "mcp.remove")).toEqual([
      { projectId: "p1", name: "files", confirm: true },
    ]);
  });

  test("--json prints the servers that are left, as list does", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["mcp", "remove", "api", "files", "--confirm", "--json"],
      daemon.port,
    );
    expect(printed(run.out)).toMatchObject({ servers: [{ name: "docs", enabled: false }] });
  });

  test("a server the project does not have is the daemon's refusal, exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "mcp.remove": () => ({
        error: { code: "not_found", message: "MCP server x does not exist" },
      }),
    });
    const run = await flightdeckd(["mcp", "remove", "api", "x", "--confirm"], daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([1, expect.stringContaining("does not exist")]);
  });

  test("a silent daemon leaves the result unknown: exit 2, and it says to check with mcp list", async () => {
    // The project is found, then the write gets no answer.
    const silent = fakeDaemon({
      "project.list": () => ({ projects: [project("p1", "api")], maxParallelRuns: 2 }),
    });
    const result = await runMcpCli(
      { action: "remove", project: "p1", server: "files" },
      config(silent.port),
      { timeoutMs: 200 },
    );
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).toContain("may or may not have been");
    expect(result.err.join("\n")).toContain("mcp list");
  });
});

describe("flightdeckd mcp toggle (issue #3616)", () => {
  test("--disable turns a server off with no --confirm of its own: it grants nothing", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(["mcp", "toggle", "api", "files", "--disable"], daemon.port);
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "files  project  stdio  off  editable  npx -y files-server",
      "docs  project  stdio  off  editable  npx -y files-server",
    ]);
    expect(callsOf(daemon, "mcp.toggle")).toEqual([
      { projectId: "p1", name: "files", enabled: false, confirm: true },
    ]);
  });

  test("--enable lets the server run in the next session, so it takes --confirm and --session names the live one", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["mcp", "toggle", "api", "docs", "--enable", "--confirm", "--session", "s1", "--json"],
      daemon.port,
    );
    expect(run.code).toBe(0);
    expect(callsOf(daemon, "mcp.toggle")).toEqual([
      { projectId: "p1", name: "docs", enabled: true, confirm: true, sessionId: "s1" },
    ]);
  });

  test("a daemon that refuses a read-only server is its refusal, exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "mcp.toggle": () => ({ error: { code: "invalid_state", message: "docs is read-only" } }),
    });
    const run = await flightdeckd(["mcp", "toggle", "api", "docs", "--disable"], daemon.port);
    expect([run.code, run.err.join("\n")]).toEqual([1, expect.stringContaining("read-only")]);
  });
});

describe("flightdeckd mcp write words and flags (issue #3616)", () => {
  test("the verbs that start a server or write the project's file need --confirm", () => {
    expect(refused(["mcp", "remove", "api", "files"])).toContain("pass --confirm");
    expect(refused(["mcp", "toggle", "api", "files", "--enable"])).toContain("pass --confirm");
  });

  test("a toggle names one direction, and --confirm is for turning on only", () => {
    expect(refused(["mcp", "toggle", "api", "files"])).toContain("--enable or --disable");
    expect(refused(["mcp", "toggle", "api", "files", "--enable", "--disable"])).toContain(
      "not both",
    );
    expect(refused(["mcp", "toggle", "api", "files", "--disable", "--confirm"])).toContain(
      "--confirm",
    );
  });

  test("a flag belongs to its verbs: list, status and the server take none of them", () => {
    const confirm = "--confirm: this flag only applies to flightdeckd mcp test, remove and toggle";
    expect(refused(["mcp", "list", "api", "--confirm"])).toContain(confirm);
    expect(refused(["mcp", "status", "s1", "--confirm"])).toContain(confirm);
    expect(refused(["mcp", "--confirm"])).toContain(confirm);
    const session = "--session: this flag only applies to flightdeckd mcp toggle";
    expect(refused(["mcp", "test", "api", "files", "--session", "s1"])).toContain(session);
    expect(refused(["mcp", "--session", "s1"])).toContain(session);
    expect(refused(["mcp", "remove", "api", "files", "--confirm", "--disable"])).toContain(
      "--disable: this flag only applies to flightdeckd mcp toggle",
    );
  });

  test("each verb asks for its operands", () => {
    expect(refused(["mcp", "remove", "api", "--confirm"])).toContain("missing the server");
    expect(refused(["mcp", "toggle", "api", "--enable", "--confirm"])).toContain(
      "missing the server",
    );
  });

  test("a bare `mcp` is still the stdio server, and a confirmed test parses as a test", () => {
    expect(parseArgs(["mcp"])).toMatchObject({ command: "mcp" });
    expect(parseArgs(["mcp"]).action).toBeUndefined();
    expect(parseArgs(["mcp", "test", "api", "files", "--confirm"])).toMatchObject({
      command: "mcp",
      action: "test",
      confirm: true,
    });
  });
});
