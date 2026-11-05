import { describe, expect, test } from "bun:test";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";
import { AsyncQueue } from "../src/async-queue.ts";
import {
  ACP_CLOSED,
  ACP_INTERNAL_ERROR,
  ACP_METHOD_NOT_FOUND,
  ACP_TIMEOUT,
  AcpClient,
  type AcpClientOptions,
  AcpError,
  spawnAcp,
} from "../src/runtime/acp/client.ts";
import { poll } from "./helpers.ts";

/** An in-memory agent: what the client wrote, and a way to write back. */
function pair(opts: AcpClientOptions = {}) {
  const lines = new AsyncQueue<string>();
  const written: Array<Record<string, unknown>> = [];
  let closed = false;
  const client = new AcpClient(
    {
      lines,
      write(line) {
        written.push(JSON.parse(line));
      },
      close() {
        closed = true;
      },
    },
    opts,
  );
  /**
   * Resolves once the client has written `count` messages in all, or after 200 turns of the event
   * loop (the stream hops are a few turns each), so a client that never writes fails an assertion.
   */
  const wrote = async (count: number) => {
    for (let turn = 0; turn < 200 && written.length < count; turn++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  return {
    client,
    written,
    wrote,
    send: (message: unknown) => lines.push(JSON.stringify(message)),
    sendRaw: (line: string) => lines.push(line),
    end: () => lines.end(),
    isClosed: () => closed,
  };
}

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

describe("acp-client", () => {
  test("a request is one JSON-RPC line with its own id and resolves with the result", async () => {
    const agent = pair();
    const first = agent.client.request<{ sessionId: string }>("session/new", { cwd: "/w" });
    const second = agent.client.request("session/list", {});
    await agent.wrote(2);
    expect(agent.written).toEqual([
      { jsonrpc: "2.0", id: 1, method: "session/new", params: { cwd: "/w" } },
      { jsonrpc: "2.0", id: 2, method: "session/list", params: {} },
    ]);
    agent.send({ jsonrpc: "2.0", id: 2, result: { sessions: [] } });
    agent.send({ jsonrpc: "2.0", id: 1, result: { sessionId: "ses_1" } });
    expect(await first).toEqual({ sessionId: "ses_1" });
    expect(await second).toEqual({ sessions: [] });
  });

  test("an error answer rejects with its code and message", async () => {
    const agent = pair();
    const call = failure(agent.client.request("session/prompt", {}));
    await agent.wrote(1);
    agent.send({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "auth_required" } });
    const error = await call;
    expect(error instanceof AcpError).toBe(true);
    expect((error as AcpError | null)?.code).toBe(-32000);
    expect((error as AcpError | null)?.message).toBe("auth_required");
  });

  test("a notification goes to onNotification, and notify writes one without an id", async () => {
    const seen: Array<[string, unknown]> = [];
    const agent = pair({ onNotification: (method, params) => seen.push([method, params]) });
    agent.client.notify("session/cancel", { sessionId: "ses_1" });
    await agent.wrote(1);
    expect(agent.written[0]).toEqual({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: "ses_1" },
    });
    agent.send({ jsonrpc: "2.0", method: "session/update", params: { n: 1 } });
    const done = agent.client.request("x", {});
    await agent.wrote(2);
    agent.send({ jsonrpc: "2.0", id: 1, result: null });
    await done;
    expect(seen).toEqual([["session/update", { n: 1 }]]);
  });

  test("a request from the agent is answered by its handler, under the agent's id", async () => {
    const agent = pair({
      requests: {
        "session/request_permission": async (params) => ({
          outcome: { outcome: "selected", optionId: (params as { pick: string }).pick },
        }),
      },
    });
    agent.send({
      jsonrpc: "2.0",
      id: 0,
      method: "session/request_permission",
      params: { pick: "once" },
    });
    await agent.wrote(1);
    expect(agent.written[0]).toEqual({
      jsonrpc: "2.0",
      id: 0,
      result: { outcome: { outcome: "selected", optionId: "once" } },
    });
  });

  test("fs/* and any method without a handler get method-not-found", async () => {
    const agent = pair({ requests: {} });
    agent.send({ jsonrpc: "2.0", id: 7, method: "fs/read_text_file", params: { path: "/etc" } });
    agent.send({ jsonrpc: "2.0", id: 8, method: "terminal/create", params: {} });
    await agent.wrote(2);
    expect(
      agent.written.map((m) => [m.id, (m.error as { code: number } | undefined)?.code]),
    ).toEqual([
      [7, ACP_METHOD_NOT_FOUND],
      [8, ACP_METHOD_NOT_FOUND],
    ]);
  });

  test("a handler's AcpError keeps its code; any other error is an internal error with no detail", async () => {
    const agent = pair({
      requests: {
        a: async () => {
          throw new AcpError(-32000, "declined");
        },
        b: async () => {
          throw new Error("secret tool output");
        },
      },
    });
    agent.send({ jsonrpc: "2.0", id: 1, method: "a", params: {} });
    agent.send({ jsonrpc: "2.0", id: 2, method: "b", params: {} });
    await agent.wrote(2);
    const byId = new Map(agent.written.map((m) => [m.id, m.error]));
    expect(byId.get(1)).toEqual({ code: -32000, message: "declined" });
    expect(byId.get(2)).toEqual({ code: ACP_INTERNAL_ERROR, message: "internal error" });
  });

  test("a request with no answer in time rejects with a timeout; null waits as long as it takes", async () => {
    const agent = pair({ timeoutMs: 1 });
    const patient = agent.client.request("session/prompt", {}, { timeoutMs: null });
    const quick = failure(agent.client.request("session/new", {}, { timeoutMs: 5 }));
    const error = await quick;
    expect((error as AcpError | null)?.code).toBe(ACP_TIMEOUT);
    // The quick one waited 5 ms, so a 1 ms default would have ended the patient one by now.
    agent.send({ jsonrpc: "2.0", id: 1, result: { stopReason: "end_turn" } });
    expect(await patient).toEqual({ stopReason: "end_turn" });
    // The default applies when the call names none.
    const byDefault = await failure(agent.client.request("x", {}));
    expect((byDefault as AcpError | null)?.code).toBe(ACP_TIMEOUT);
  });

  test("when the agent's output ends, every pending request fails and later ones fail at once", async () => {
    const agent = pair();
    const pending = failure(agent.client.request("session/prompt", {}, { timeoutMs: null }));
    await agent.wrote(1);
    agent.end();
    expect(((await pending) as AcpError | null)?.code).toBe(ACP_CLOSED);
    await agent.client.closed;
    expect(((await failure(agent.client.request("x", {}))) as AcpError | null)?.code).toBe(
      ACP_CLOSED,
    );
    expect(agent.written.length).toBe(1);
  });

  test("close closes the agent's stdin", () => {
    const agent = pair();
    agent.client.close();
    expect(agent.isClosed()).toBe(true);
  });

  test("protocol problems are logged without the message's text", async () => {
    const logs: string[] = [];
    const agent = pair({ log: (m) => logs.push(m) });
    agent.sendRaw("not json: SECRET-PROMPT");
    agent.send({ jsonrpc: "2.0", id: 99, result: { text: "SECRET-OUTPUT" } });
    agent.sendRaw("");
    const done = agent.client.request("x", {});
    await agent.wrote(1);
    agent.send({ jsonrpc: "2.0", id: 1, result: null });
    await done;
    expect(logs.length).toBe(2);
    expect(logs.join("\n")).not.toContain("SECRET");
  });

  test("a throwing handler or a line that is not an object does not stop the reading; it is logged without text", async () => {
    const logs: string[] = [];
    const agent = pair({
      log: (m) => logs.push(m),
      onNotification: () => {
        throw new Error("SECRET-BAD-SHAPE");
      },
    });
    let closedWith: unknown = null;
    void agent.client.closed.catch((error: unknown) => {
      closedWith = error;
    });
    let answer: unknown = null;
    void agent.client.request("session/prompt", {}, { timeoutMs: null }).then((r) => {
      answer = r;
    });
    await agent.wrote(1);
    agent.send({ jsonrpc: "2.0", method: "session/update", params: {} });
    agent.sendRaw("null");
    agent.sendRaw("42");
    agent.sendRaw("{}");
    agent.send({ jsonrpc: "2.0", id: 1, result: { stopReason: "end_turn" } });
    expect(await poll(() => answer)).toEqual({ stopReason: "end_turn" });
    expect(closedWith).toBe(null);
    expect(logs.length).toBe(4);
    expect(logs.join("\n")).not.toContain("SECRET");
  });

  test("spawnAcp runs the agent with the given folder and environment over piped stdio", async () => {
    const cwd = realTempDir("fd-acp-spawn-");
    const script = [
      "for await (const chunk of Bun.stdin.stream()) {",
      "  for (const line of new TextDecoder().decode(chunk).split('\\n').filter(Boolean)) {",
      "    const m = JSON.parse(line);",
      "    console.log(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { cwd: process.cwd(), marker: process.env.FD_MARKER } }));",
      "  }",
      "}",
    ].join("\n");
    const agent = spawnAcp([process.execPath, "-e", script], {
      cwd,
      env: { PATH: process.env.PATH ?? "", FD_MARKER: "m-1" },
    });
    const client = new AcpClient(agent);
    expect(await client.request("ping", {})).toEqual({ cwd, marker: "m-1" });
    client.close();
    expect(await agent.exited).toBe(0);
    await client.closed;
  });

  test.skipIf(process.platform === "win32")(
    "on POSIX the agent leads its own process group, so a tree kill reaches what it starts",
    async () => {
      const agent = spawnAcp(["sh", "-c", 'echo "$$ $(ps -o pgid= -p $$)"; read _'], {
        cwd: realTempDir("fd-acp-group-"),
        env: { PATH: process.env.PATH ?? "" },
      });
      let line = "";
      for await (const text of agent.lines) {
        line = text;
        break;
      }
      const [pid, pgid] = line.trim().split(/\s+/);
      agent.close();
      await agent.exited;
      expect(pgid).toBe(pid);
    },
  );

  test("kill ends an agent that does not stop on its own", async () => {
    const agent = spawnAcp([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
      cwd: realTempDir("fd-acp-kill-"),
      env: { PATH: process.env.PATH ?? "" },
    });
    agent.kill();
    expect(await agent.exited).not.toBe(0);
  });
});
