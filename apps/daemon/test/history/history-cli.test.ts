import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { CliResult } from "../../src/daemon-client/index.ts";
import { runHistoryCli } from "../../src/history/history-cli.ts";
import { parseArgs } from "../../src/main.ts";
import { config, fakeDaemon, stopAll } from "../board/card-cli-helpers.ts";

setDefaultTimeout(20_000);
afterEach(stopAll);

const text = (r: CliResult) => [...r.out, ...r.err].join("\n");
/** The parsed arguments, or what the parser refused with: a wrong parse fails an assertion. */
function parsed(argv: string[]): unknown {
  try {
    return parseArgs(argv);
  } catch (error) {
    return { refusedWith: (error as Error).message };
  }
}

const session = (id: string, over: Record<string, unknown> = {}) => ({
  claudeSessionId: id,
  cwd: "/w/api",
  title: "Fix the login",
  firstTs: "2026-11-19T10:00:00.000Z",
  lastTs: "2026-11-19T11:00:00.000Z",
  messageCount: 12,
  origin: "flightdeck",
  maybeActive: false,
  ...over,
});
const message = (uuid: string, over: Record<string, unknown> = {}) => ({
  uuid,
  ts: "2026-11-19T10:01:00.000Z",
  role: "user",
  kind: "message",
  text: "why does login fail?",
  ...over,
});
const calls = (daemon: ReturnType<typeof fakeDaemon>, type: string) =>
  daemon.calls.filter((c) => c.type === type);

describe("flightdeckd history list (issue #3461)", () => {
  test("it sends only the filters it was given and prints one line per session", async () => {
    const daemon = fakeDaemon({
      "history.list": () => ({
        sessions: [
          session("s1"),
          session("s2", { title: null, cwd: "/w/web", maybeActive: true, messageCount: 3 }),
        ],
        nextCursor: null,
      }),
    });
    const result = await runHistoryCli(
      { action: "list", cwd: "/w/api", origin: "external", hideAutomated: true, limit: 5 },
      config(daemon.port),
    );
    expect(result.code).toBe(0);
    expect(calls(daemon, "history.list")[0]?.payload).toEqual({
      cwd: "/w/api",
      origin: "external",
      hideAutomated: true,
      limit: 5,
    });
    expect(result.out).toEqual([
      "s1  2026-11-19T11:00:00.000Z  /w/api  Fix the login (12 messages)",
      "s2  2026-11-19T11:00:00.000Z  /w/web  (untitled) (3 messages) [may be running]",
    ]);
  });

  test("a next page is named with the flag that reads it", async () => {
    const daemon = fakeDaemon({
      "history.list": () => ({ sessions: [session("s1")], nextCursor: "abc" }),
    });
    const result = await runHistoryCli({ action: "list" }, config(daemon.port));
    expect(result.out.at(-1)).toBe("more: history list --cursor abc");
  });

  test("--json prints the daemon's answer as one document", async () => {
    const answer = { sessions: [session("s1")], nextCursor: null };
    const daemon = fakeDaemon({ "history.list": () => answer });
    const result = await runHistoryCli({ action: "list", json: true }, config(daemon.port));
    expect(result.out.join("\n")).toStartWith("{");
    expect(JSON.parse(result.out.join("\n"))).toEqual(answer);
  });

  test("a title with a terminal escape cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      "history.list": () => ({
        sessions: [session("s1", { title: `a${String.fromCharCode(27)}[2Jb` })],
        nextCursor: null,
      }),
    });
    const result = await runHistoryCli({ action: "list" }, config(daemon.port));
    expect(result.out.join("")).not.toContain(String.fromCharCode(27));
    expect(result.out[0]).toContain("a [2Jb");
  });

  test("a refusal exits 1 with the daemon's reason", async () => {
    const daemon = fakeDaemon({
      "history.list": () => ({ error: { code: "invalid", message: "bad cursor" } }),
    });
    const result = await runHistoryCli({ action: "list", cursor: "x" }, config(daemon.port));
    expect(result.code).toBe(1);
    expect(text(result)).toContain("bad cursor");
  });

  test("no daemon exits 2", async () => {
    const result = await runHistoryCli({ action: "list" }, config(1));
    expect(result.code).toBe(2);
  });
});

describe("flightdeckd history search (issue #3461)", () => {
  test("it sends the query and prints one line per hit with its snippet", async () => {
    const daemon = fakeDaemon({
      "history.search": () => ({
        hits: [
          {
            claudeSessionId: "s1",
            uuid: "u1",
            ts: "2026-11-19T10:01:00.000Z",
            cwd: "/w/api",
            title: "Fix the login",
            role: "user",
            snippet: "why does «login» fail?",
            cursor: "c1",
          },
        ],
      }),
    });
    const result = await runHistoryCli(
      { action: "search", query: "login", cwd: "/w/api", limit: 10 },
      config(daemon.port),
    );
    expect(result.code).toBe(0);
    expect(calls(daemon, "history.search")[0]?.payload).toEqual({
      query: "login",
      cwd: "/w/api",
      limit: 10,
    });
    expect(result.out).toEqual(["s1  u1  2026-11-19T10:01:00.000Z  user: why does «login» fail?"]);
  });

  test("no hit says so", async () => {
    const daemon = fakeDaemon({ "history.search": () => ({ hits: [] }) });
    const result = await runHistoryCli({ action: "search", query: "zzz" }, config(daemon.port));
    expect(result.out).toEqual(["no session matches"]);
  });
});

describe("flightdeckd history get (issue #3461)", () => {
  test("it prints the transcript, a message per block, and names the next page", async () => {
    const daemon = fakeDaemon({
      "history.get": () => ({
        session: session("s1"),
        messages: [
          message("u1"),
          message("u2", { role: "assistant", text: "first line\nsecond line" }),
        ],
        nextCursor: "n2",
        prevCursor: null,
      }),
    });
    const result = await runHistoryCli(
      { action: "get", claudeSessionId: "s1", tail: true, limit: 2 },
      config(daemon.port),
    );
    expect(result.code).toBe(0);
    expect(calls(daemon, "history.get")[0]?.payload).toEqual({
      claudeSessionId: "s1",
      tail: true,
      limit: 2,
    });
    expect(result.out).toEqual([
      "2026-11-19T10:01:00.000Z user: why does login fail?",
      "2026-11-19T10:01:00.000Z assistant: first line",
      "  second line",
      "more: history get s1 --cursor n2",
    ]);
  });

  test("a message with a terminal escape cannot drive the terminal", async () => {
    const daemon = fakeDaemon({
      "history.get": () => ({
        session: session("s1"),
        messages: [message("u1", { text: `x${String.fromCharCode(27)}[31my` })],
        nextCursor: null,
        prevCursor: null,
      }),
    });
    const result = await runHistoryCli(
      { action: "get", claudeSessionId: "s1" },
      config(daemon.port),
    );
    expect(result.out.join("")).not.toContain(String.fromCharCode(27));
  });

  test("an unknown session exits 1", async () => {
    const daemon = fakeDaemon({
      "history.get": () => ({ error: { code: "not_found", message: "no such session" } }),
    });
    const result = await runHistoryCli(
      { action: "get", claudeSessionId: "nope" },
      config(daemon.port),
    );
    expect(result.code).toBe(1);
    expect(text(result)).toContain("no such session");
  });
});

describe("flightdeckd history tool (issue #3461)", () => {
  test("it prints the call's input and its result, and says when they were cut", async () => {
    const daemon = fakeDaemon({
      "history.tool": () => ({
        tool: {
          name: "Bash",
          input: { command: "ls" },
          result: { content: "a\nb", isError: false },
          truncated: true,
        },
      }),
    });
    const result = await runHistoryCli(
      { action: "tool", claudeSessionId: "s1", uuid: "u1", index: 0 },
      config(daemon.port),
    );
    expect(result.code).toBe(0);
    expect(calls(daemon, "history.tool")[0]?.payload).toEqual({
      claudeSessionId: "s1",
      uuid: "u1",
      index: 0,
    });
    expect(result.out).toEqual([
      "Bash",
      'input: {"command":"ls"}',
      "result:",
      "  a",
      "  b",
      "(cut: the transcript holds more)",
    ]);
  });

  test("a call the transcript does not hold exits 1", async () => {
    const daemon = fakeDaemon({ "history.tool": () => ({ tool: null }) });
    const result = await runHistoryCli(
      { action: "tool", claudeSessionId: "s1", uuid: "u1", index: 3 },
      config(daemon.port),
    );
    expect(result.code).toBe(1);
    expect(text(result)).toContain("no tool call");
  });
});

describe("the arguments of history list|search|get|tool (issue #3461)", () => {
  test("list takes the filters", () => {
    expect(
      parsed([
        "history",
        "list",
        "--cwd",
        "/w/api",
        "--project-key",
        "k",
        "--from",
        "2026-11-01",
        "--to",
        "2026-11-20",
        "--origin",
        "external",
        "--hide-automated",
        "--limit",
        "5",
        "--cursor",
        "abc",
        "--json",
      ]),
    ).toMatchObject({
      command: "history",
      action: "list",
      cwd: "/w/api",
      projectKey: "k",
      from: "2026-11-01",
      to: "2026-11-20",
      origin: "external",
      hideAutomated: true,
      limit: 5,
      cursor: "abc",
      json: true,
    });
  });

  test("search takes the text, get and tool take the ids", () => {
    expect(parsed(["history", "search", "login", "--limit", "3"])).toMatchObject({
      action: "search",
      query: "login",
      limit: 3,
    });
    expect(parsed(["history", "get", "s1", "--tail", "--limit", "20"])).toMatchObject({
      action: "get",
      claudeSessionId: "s1",
      tail: true,
      limit: 20,
    });
    expect(parsed(["history", "tool", "s1", "u1", "2"])).toMatchObject({
      action: "tool",
      claudeSessionId: "s1",
      uuid: "u1",
      index: 2,
    });
  });

  test("reindex still parses", () => {
    expect(parsed(["history", "reindex"])).toMatchObject({ command: "history", action: "reindex" });
  });

  test("a bad value or a flag of another verb is refused before anything is sent", () => {
    expect(parsed(["history", "list", "--origin", "mars"])).toMatchObject({
      refusedWith: expect.stringContaining("--origin"),
    });
    expect(parsed(["history", "list", "--limit", "0"])).toMatchObject({
      refusedWith: expect.stringContaining("--limit"),
    });
    expect(parsed(["history", "list", "--limit", "999"])).toMatchObject({
      refusedWith: expect.stringContaining("--limit"),
    });
    expect(parsed(["history", "tool", "s1", "u1", "-1"])).toMatchObject({
      refusedWith: expect.stringContaining("index"),
    });
    expect(parsed(["history", "list", "--tail"])).toMatchObject({
      refusedWith: expect.stringContaining("--tail"),
    });
    expect(parsed(["history", "search"])).toMatchObject({
      refusedWith: expect.stringContaining("missing"),
    });
    expect(parsed(["card", "list", "--cursor", "x"])).toMatchObject({
      refusedWith: expect.stringContaining("--cursor"),
    });
  });
});
