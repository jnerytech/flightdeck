import { afterEach, describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { type OtlpEvent, type OtlpReceiver, startOtlpReceiver } from "../src/telemetry/otlp.ts";
import { jsonLogs, protobufLogs, type TestRecord } from "./otlp-helpers.ts";

const TOKEN = "otlp-token-0123456789abcdef";
const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

function receiver(over: { token?: string | null; maxBytes?: number } = {}) {
  const got: OtlpEvent[][] = [];
  const server: OtlpReceiver = startOtlpReceiver({
    port: 0,
    token: () => (over.token === undefined ? TOKEN : over.token),
    ...(over.maxBytes ? { maxBytes: over.maxBytes } : {}),
    onEvents: (events) => got.push(events),
  });
  stops.push(server.stop);
  return { server, got };
}

const RECORDS: TestRecord[] = [
  {
    name: "tool_result",
    timeMs: 1_700_000_000_123,
    attrs: {
      "session.id": "s-1",
      "prompt.id": "p-1",
      tool_name: "Bash",
      duration_ms: 1500,
      success: "true",
    },
  },
];
const post = (
  server: OtlpReceiver,
  path: string,
  body: RequestInit["body"],
  headers: Record<string, string> = {},
) =>
  fetch(`${server.url}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...headers },
    body,
  });

describe("otlp-receptor: what it refuses, before anything is decoded", () => {
  test("it listens on 127.0.0.1 only", () => {
    const { server } = receiver();
    expect(server.url.startsWith("http://127.0.0.1:")).toBe(true);
  });

  test("no token, a wrong one, or no token installed: 401, and nothing reaches the store", async () => {
    const { server, got } = receiver();
    const body = jsonLogs(RECORDS);
    for (const headers of [{ authorization: "" }, { authorization: "Bearer nope" }]) {
      const res = await post(server, "/v1/logs", body, headers);
      expect(res.status).toBe(401);
    }
    const bare = await fetch(`${server.url}/v1/logs`, { method: "POST", body });
    expect(bare.status).toBe(401);
    const none = receiver({ token: null });
    expect((await post(none.server, "/v1/logs", body, { authorization: "Bearer " })).status).toBe(
      401,
    );
    expect((await post(none.server, "/v1/logs", body)).status).toBe(401);
    expect(got).toEqual([]);
    expect(none.got).toEqual([]);
  });

  test("only POST on /v1/logs and /v1/metrics: other methods are 405, other paths 404", async () => {
    const { server } = receiver();
    const get = await fetch(`${server.url}/v1/logs`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(get.status).toBe(405);
    expect((await post(server, "/v1/traces", "{}")).status).toBe(404);
    expect((await post(server, "/", "{}")).status).toBe(404);
  });

  test("a body over the limit is 413: declared, streamed without a length, or inflated by gzip", async () => {
    const { server, got } = receiver({ maxBytes: 2_000 });
    const big = jsonLogs(
      Array.from({ length: 40 }, (_, i) => ({ ...RECORDS[0], timeMs: i }) as TestRecord),
    );
    expect(big.length).toBeGreaterThan(2_000);
    expect((await post(server, "/v1/logs", big)).status).toBe(413);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const chunked = await fetch(`${server.url}/v1/logs`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(chunked.status).toBe(413);
    // Small on the wire, large once inflated.
    const bomb = gzipSync(Buffer.alloc(200_000, 0x20));
    expect(bomb.length).toBeLessThan(2_000);
    expect((await post(server, "/v1/logs", bomb, { "content-encoding": "gzip" })).status).toBe(413);
    expect(got).toEqual([]);
  });

  test("a content type that is not OTLP's is 415, and a body that does not decode is 400", async () => {
    const { server, got } = receiver();
    const text = await post(server, "/v1/logs", "hello", { "content-type": "text/plain" });
    expect(text.status).toBe(415);
    expect((await post(server, "/v1/logs", "{not json")).status).toBe(400);
    expect(
      (
        await post(server, "/v1/logs", new Uint8Array([0x0a, 0xff, 0xff, 0x01]), {
          "content-type": "application/x-protobuf",
        })
      ).status,
    ).toBe(400);
    expect(got).toEqual([]);
  });
});

describe("otlp-receptor: what it accepts", () => {
  const EXPECTED: OtlpEvent = {
    name: "tool_result",
    timeMs: 1_700_000_000_123,
    sessionId: "s-1",
    promptId: "p-1",
    attrs: { tool_name: "Bash", duration_ms: 1500, success: "true" },
  };

  test("JSON, protobuf and gzipped JSON give the same event", async () => {
    const { server, got } = receiver();
    const json = await post(server, "/v1/logs", jsonLogs(RECORDS));
    expect(json.status).toBe(200);
    const proto = await post(server, "/v1/logs", protobufLogs(RECORDS), {
      "content-type": "application/x-protobuf",
    });
    expect(proto.status).toBe(200);
    const zipped = await post(server, "/v1/logs", gzipSync(jsonLogs(RECORDS)), {
      "content-encoding": "gzip",
    });
    expect(zipped.status).toBe(200);
    expect(got).toEqual([[EXPECTED], [EXPECTED], [EXPECTED]]);
  });

  test("the session id may come on the resource; a missing prompt id is null", async () => {
    const { server, got } = receiver();
    const records: TestRecord[] = [
      { name: "api_error", timeMs: 5, attrs: { status_code: 529, duration_ms: 20.5 } },
    ];
    await post(server, "/v1/logs", jsonLogs(records, { "session.id": "s-9" }));
    await post(server, "/v1/logs", protobufLogs(records, { "session.id": "s-9" }), {
      "content-type": "application/x-protobuf",
    });
    const event = {
      name: "api_error",
      timeMs: 5,
      sessionId: "s-9",
      promptId: null,
      attrs: { status_code: 529, duration_ms: 20.5 },
    };
    expect(got).toEqual([[event], [event]]);
  });

  test("content never gets in: prompts, responses, tool input and bodies are dropped even when sent", async () => {
    const { server, got } = receiver();
    await post(
      server,
      "/v1/logs",
      jsonLogs([
        {
          name: "user_prompt",
          timeMs: 1,
          attrs: {
            "session.id": "s-1",
            prompt_length: 12,
            prompt: "my secret prompt",
            prompt_text: "my secret prompt",
            response: "an answer",
            tool_parameters: '{"command":"cat ~/.ssh/id_rsa"}',
            tool_input: "x",
            body: "{}",
            error: "full message with a path",
          },
        },
      ]),
    );
    expect(got[0]?.[0]?.attrs).toEqual({ prompt_length: 12 });
  });

  test("metrics are accepted and not kept", async () => {
    const { server, got } = receiver();
    expect((await post(server, "/v1/metrics", '{"resourceMetrics":[]}')).status).toBe(200);
    expect(got).toEqual([]);
  });
});
