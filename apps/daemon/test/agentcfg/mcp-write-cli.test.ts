import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runMcpCli } from "../../src/agentcfg/index.ts";
import { parseArgs } from "../../src/main.ts";
import { config, fakeDaemon, type Handlers, project, stopAll } from "../board/card-cli-helpers.ts";
import { flightdeckd } from "../support/cli-run.ts";
import { tempDir } from "../support/helpers.ts";

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
  "mcp.save": () => ({ servers: [{ ...FILES, env: { API_KEY: "••••••" } }] }),
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

  test("a tool name from the started server cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "mcp.test": () => ({
        tools: ["evil\u001b[2J", "ok\u0007"],
        resources: ["r\u001b]0;x\u0007"],
      }),
    });
    const run = await flightdeckd(["mcp", "test", "api", "files", "--confirm"], daemon.port);
    const control = run.out.some((line) =>
      [...line].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
    );
    expect([run.code, run.out.length, control]).toEqual([0, 2, false]);
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

const SERVER = {
  name: "files",
  type: "stdio",
  command: "npx",
  args: ["-y", "files-server"],
  env: { API_KEY: "s3cret" },
};

/** A file holding `content` (an object is written as JSON): the server a person describes for `mcp save`. */
function serverFile(content: unknown): string {
  const path = join(tempDir("fd-mcp-save-"), "server.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

const stdin = (text: string) => ({ stdin: new Response(text).body as ReadableStream<Uint8Array> });

describe("flightdeckd mcp save (issue #3616)", () => {
  test("it saves the server a file describes and prints the project's servers; the request carries the server and confirm", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["mcp", "save", "api", serverFile(SERVER), "--confirm"],
      daemon.port,
    );
    expect({ code: run.code, err: run.err }).toEqual({ code: 0, err: [] });
    expect(run.out).toEqual([
      "saved files",
      "files  project  stdio  on  editable  npx -y files-server  env API_KEY",
    ]);
    expect(callsOf(daemon, "mcp.save")).toEqual([
      { projectId: "p1", server: SERVER, confirm: true },
    ]);
  });

  test("`-` reads the server from standard input, so a secret never goes on the command line", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["mcp", "save", "p1", "-", "--confirm", "--json"],
      daemon.port,
      undefined,
      stdin(JSON.stringify(SERVER)),
    );
    expect(run.code).toBe(0);
    expect(printed(run.out)).toMatchObject({ servers: [{ name: "files" }] });
    expect(callsOf(daemon, "mcp.save")).toEqual([
      { projectId: "p1", server: SERVER, confirm: true },
    ]);
  });

  test("what a person typed in a secret is never printed, not even when the file is refused", async () => {
    const daemon = fakeDaemon(OPEN);
    const typed = { ...SERVER, cmd: "npx" };
    const unknownKey = await flightdeckd(
      ["mcp", "save", "api", serverFile(typed), "--confirm"],
      daemon.port,
    );
    const cut = await flightdeckd(
      ["mcp", "save", "api", serverFile('{"name":"files","env":{"API_KEY":"s3cret"'), "--confirm"],
      daemon.port,
    );
    const everything = [...unknownKey.out, ...unknownKey.err, ...cut.out, ...cut.err].join("\n");
    expect([unknownKey.code, cut.code, everything.includes("s3cret")]).toEqual([1, 1, false]);
    expect(unknownKey.err.join("\n")).toContain("cmd");
    expect(callsOf(daemon, "mcp.save")).toEqual([]);
  });

  test("a server with no name, a key the daemon does not know and a file that is no JSON object are refused before the daemon hears of it", async () => {
    const daemon = fakeDaemon(OPEN);
    const nameless = await flightdeckd(
      ["mcp", "save", "api", serverFile({ command: "npx" }), "--confirm"],
      daemon.port,
    );
    const list = await flightdeckd(
      ["mcp", "save", "api", serverFile("[]"), "--confirm"],
      daemon.port,
    );
    const missing = await flightdeckd(
      ["mcp", "save", "api", join(tempDir("fd-mcp-save-"), "none.json"), "--confirm"],
      daemon.port,
    );
    expect([nameless.code, list.code, missing.code]).toEqual([1, 1, 1]);
    expect(nameless.err.join("\n")).toContain("name");
    expect(missing.err.join("\n")).toContain("cannot read");
    expect(callsOf(daemon, "mcp.save")).toEqual([]);
  });

  test("a server with nothing to run, neither a command nor a link, is refused", async () => {
    const daemon = fakeDaemon(OPEN);
    const run = await flightdeckd(
      ["mcp", "save", "api", serverFile({ name: "files", args: ["-y"] }), "--confirm"],
      daemon.port,
    );
    expect([run.code, run.err.join("\n")]).toEqual([1, expect.stringContaining("command")]);
    expect(callsOf(daemon, "mcp.save")).toEqual([]);
  });

  test("a server whose type does not match what it names to run, or whose link is no URL, is refused", async () => {
    const daemon = fakeDaemon(OPEN);
    const shapes = [
      { name: "a", type: "stdio", url: "https://h.example/mcp" },
      { name: "b", type: "http", command: "npx" },
      { name: "c", command: "   " },
      { name: "d", url: "not a url" },
    ];
    const codes: number[] = [];
    for (const shape of shapes)
      codes.push(
        (await flightdeckd(["mcp", "save", "api", serverFile(shape), "--confirm"], daemon.port))
          .code,
      );
    expect(codes).toEqual([1, 1, 1, 1]);
    expect(callsOf(daemon, "mcp.save")).toEqual([]);
  });

  test("a file that is refused is exit 1 whether or not a daemon runs, since it is read before one is asked", async () => {
    const daemon = fakeDaemon(OPEN);
    const { port } = daemon;
    await stopAll();
    const run = await flightdeckd(["mcp", "save", "api", serverFile("[]"), "--confirm"], port);
    expect(run.code).toBe(1);
  });

  test("a masked value is the daemon's refusal, exit 1", async () => {
    const daemon = fakeDaemon({
      ...OPEN,
      "mcp.save": () => ({
        error: {
          code: "invalid_state",
          message: "env and header values show masked: type the value again",
        },
      }),
    });
    const run = await flightdeckd(
      ["mcp", "save", "api", serverFile({ ...SERVER, env: { API_KEY: "••••••" } }), "--confirm"],
      daemon.port,
    );
    expect([run.code, run.err.join("\n")]).toEqual([1, expect.stringContaining("masked")]);
  });

  test("a silent daemon leaves the result unknown: exit 2, and it says to check with mcp list", async () => {
    const silent = fakeDaemon({
      "project.list": () => ({ projects: [project("p1", "api")], maxParallelRuns: 2 }),
    });
    const result = await runMcpCli(
      { action: "save", project: "p1", file: serverFile(SERVER) },
      config(silent.port),
      { timeoutMs: 200 },
    );
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).toContain("may or may not have been");
    expect(result.err.join("\n")).toContain("mcp list");
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
    const confirm =
      "--confirm: this flag only applies to flightdeckd mcp test, remove, save and toggle";
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

  test("save needs --confirm and its file, and takes no direction flag", () => {
    expect(refused(["mcp", "save", "api", "f.json"])).toContain("pass --confirm");
    expect(refused(["mcp", "save", "api", "--confirm"])).toContain("missing the file");
    expect(refused(["mcp", "save", "api", "f.json", "--confirm", "--enable"])).toContain(
      "--enable: this flag only applies to flightdeckd mcp toggle",
    );
    expect(parseArgs(["mcp", "save", "api", "-", "--confirm"])).toMatchObject({
      command: "mcp",
      action: "save",
      confirm: true,
    });
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
