import { gunzipSync } from "node:zlib";

/** One Claude Code event (an OTLP log record) in the shape the daemon keeps. */
export interface OtlpEvent {
  /** Without the `claude_code.` prefix: `tool_result`, `api_request`... */
  name: string;
  timeMs: number;
  sessionId: string;
  promptId: string | null;
  attrs: Record<string, string | number | boolean>;
}

export interface OtlpReceiverOptions {
  /** 0 picks a free port (tests and smokes). */
  port: number;
  /** The receiver's own token, read on every request; none installed means every request is refused. */
  token: () => string | null | undefined;
  /** Largest body, before and after gunzip, in bytes. */
  maxBytes?: number;
  onEvents: (events: OtlpEvent[]) => void;
}

export interface OtlpReceiver {
  url: string;
  port: number;
  stop(): Promise<void>;
}

export class OtlpDecodeError extends Error {}

export const DEFAULT_MAX_BYTES = 1024 * 1024;

/**
 * The only attributes of an event that are kept: timings, sizes, counts, tokens, cost and the
 * names of the decision. Anything else (prompts, responses, tool input and parameters, full
 * errors, paths, e-mail and account ids) is dropped even when an exporter sends it.
 */
export const KEPT_ATTRS: ReadonlySet<string> = new Set([
  "tool_name",
  "tool_use_id",
  "request_id",
  "duration_ms",
  "success",
  "error_type",
  "decision",
  "decision_type",
  "decision_source",
  "source",
  "tool_source",
  "permission_mode",
  "classifier_verdict",
  "mcp_server_scope",
  "tool_input_size_bytes",
  "tool_result_size_bytes",
  "prompt_length",
  "response_length",
  "command_source",
  "model",
  "query_source",
  "speed",
  "effort",
  "cost_usd",
  "cost_usd_micros",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_creation_tokens",
  "status_code",
  "attempt",
]);

type Scalar = string | number | boolean;
type Attrs = Map<string, Scalar>;

const PREFIX = "claude_code.";

function toEvent(attrs: Attrs, resource: Attrs, body: Scalar | undefined, timeMs: number) {
  const rawName = attrs.get("event.name") ?? body;
  if (typeof rawName !== "string" || !rawName.startsWith(PREFIX)) return null;
  const sessionId = attrs.get("session.id") ?? resource.get("session.id");
  if (typeof sessionId !== "string" || !sessionId) return null;
  const prompt = attrs.get("prompt.id");
  const kept: OtlpEvent["attrs"] = {};
  for (const [key, value] of attrs) if (KEPT_ATTRS.has(key)) kept[key] = value;
  return {
    name: rawName.slice(PREFIX.length),
    timeMs,
    sessionId,
    promptId: typeof prompt === "string" && prompt ? prompt : null,
    attrs: kept,
  } satisfies OtlpEvent;
}

// ---- JSON ----------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function jsonValue(raw: unknown): Scalar | undefined {
  const v = obj(raw);
  if (typeof v.stringValue === "string") return v.stringValue;
  if (typeof v.boolValue === "boolean") return v.boolValue;
  if (v.intValue !== undefined) {
    const n = Number(v.intValue);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof v.doubleValue === "number") return v.doubleValue;
  return undefined;
}

function jsonAttrs(raw: unknown): Attrs {
  const out: Attrs = new Map();
  for (const item of list(raw)) {
    const kv = obj(item);
    const value = jsonValue(kv.value);
    if (typeof kv.key === "string" && value !== undefined) out.set(kv.key, value);
  }
  return out;
}

const nanosToMs = (nanos: bigint) => Number(nanos / 1_000_000n);

function decodeJson(text: string): OtlpEvent[] {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new OtlpDecodeError("JSON that does not parse");
  }
  const events: OtlpEvent[] = [];
  for (const rl of list(obj(root).resourceLogs)) {
    const resource = jsonAttrs(obj(obj(rl).resource).attributes);
    for (const sl of list(obj(rl).scopeLogs)) {
      for (const lr of list(obj(sl).logRecords)) {
        const rec = obj(lr);
        let nanos = 0n;
        try {
          nanos = BigInt(String(rec.timeUnixNano ?? rec.observedTimeUnixNano ?? 0));
        } catch {
          throw new OtlpDecodeError("a time that is not a number");
        }
        const event = toEvent(
          jsonAttrs(rec.attributes),
          resource,
          jsonValue(rec.body),
          nanosToMs(nanos),
        );
        if (event) events.push(event);
      }
    }
  }
  return events;
}

// ---- protobuf ------------------------------------------------------------------------------

interface Field {
  num: number;
  wire: number;
  /** Varint and fixed64 as bigint; length-delimited as bytes. */
  value: bigint | Uint8Array;
}

function readFields(buf: Uint8Array): Field[] {
  const fields: Field[] = [];
  let pos = 0;
  const varint = (): bigint => {
    let result = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      const byte = buf[pos++];
      if (byte === undefined) throw new OtlpDecodeError("protobuf cut short");
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return result;
    }
    throw new OtlpDecodeError("protobuf varint too long");
  };
  while (pos < buf.length) {
    const key = Number(varint());
    const num = key >>> 3;
    const wire = key & 7;
    if (num === 0) throw new OtlpDecodeError("protobuf field 0");
    if (wire === 0) fields.push({ num, wire, value: varint() });
    else if (wire === 1) {
      if (pos + 8 > buf.length) throw new OtlpDecodeError("protobuf cut short");
      const view = new DataView(buf.buffer, buf.byteOffset + pos, 8);
      pos += 8;
      fields.push({ num, wire, value: view.getBigUint64(0, true) });
    } else if (wire === 2) {
      const length = Number(varint());
      if (pos + length > buf.length) throw new OtlpDecodeError("protobuf cut short");
      fields.push({ num, wire, value: buf.subarray(pos, pos + length) });
      pos += length;
    } else if (wire === 5) {
      if (pos + 4 > buf.length) throw new OtlpDecodeError("protobuf cut short");
      pos += 4;
    } else throw new OtlpDecodeError("protobuf wire type not supported");
  }
  return fields;
}

const bytesOf = (fields: Field[], num: number): Uint8Array[] =>
  fields.flatMap((f) => (f.num === num && f.value instanceof Uint8Array ? [f.value] : []));
const text = new TextDecoder("utf-8", { fatal: true });

function protoString(bytes: Uint8Array): string {
  try {
    return text.decode(bytes);
  } catch {
    throw new OtlpDecodeError("protobuf string that is not UTF-8");
  }
}

function protoValue(buf: Uint8Array): Scalar | undefined {
  for (const f of readFields(buf)) {
    if (f.num === 1 && f.value instanceof Uint8Array) return protoString(f.value);
    if (f.num === 2 && typeof f.value === "bigint") return f.value !== 0n;
    if (f.num === 3 && typeof f.value === "bigint") return Number(BigInt.asIntN(64, f.value));
    if (f.num === 4 && typeof f.value === "bigint") {
      const view = new DataView(new ArrayBuffer(8));
      view.setBigUint64(0, f.value, true);
      return view.getFloat64(0, true);
    }
  }
  return undefined;
}

function protoAttrs(items: Uint8Array[]): Attrs {
  const out: Attrs = new Map();
  for (const item of items) {
    const kv = readFields(item);
    const key = bytesOf(kv, 1)[0];
    const raw = bytesOf(kv, 2)[0];
    const value = raw ? protoValue(raw) : undefined;
    if (key && value !== undefined) out.set(protoString(key), value);
  }
  return out;
}

function decodeProtobuf(buf: Uint8Array): OtlpEvent[] {
  const events: OtlpEvent[] = [];
  for (const rl of bytesOf(readFields(buf), 1)) {
    const rlFields = readFields(rl);
    const resourceBytes = bytesOf(rlFields, 1)[0];
    const resource = protoAttrs(resourceBytes ? bytesOf(readFields(resourceBytes), 1) : []);
    for (const sl of bytesOf(rlFields, 2)) {
      for (const lr of bytesOf(readFields(sl), 2)) {
        const fields = readFields(lr);
        const time = fields.find((f) => f.num === 1 && typeof f.value === "bigint")?.value;
        const observed = fields.find((f) => f.num === 11 && typeof f.value === "bigint")?.value;
        const body = bytesOf(fields, 5)[0];
        const event = toEvent(
          protoAttrs(bytesOf(fields, 6)),
          resource,
          body ? protoValue(body) : undefined,
          nanosToMs(typeof time === "bigint" ? time : typeof observed === "bigint" ? observed : 0n),
        );
        if (event) events.push(event);
      }
    }
  }
  return events;
}

/** Decodes an `ExportLogsServiceRequest` in JSON or protobuf. */
export function decodeLogs(contentType: string, body: Uint8Array): OtlpEvent[] {
  return contentType.startsWith("application/x-protobuf")
    ? decodeProtobuf(body)
    : decodeJson(new TextDecoder().decode(body));
}

// ---- receiver ------------------------------------------------------------------------------

const TYPES = ["application/json", "application/x-protobuf"];

class TooBig extends Error {}

async function readBody(req: Request, max: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max) throw new TooBig();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (req.body) {
    for await (const chunk of req.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > max) throw new TooBig();
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks);
}

/**
 * OTLP/HTTP receiver for Claude Code's logs, always on 127.0.0.1 (the exporter runs on this
 * machine), with its own token. The token comes first: nothing of a request is read or decoded
 * before it is checked.
 */
export function startOtlpReceiver(opts: OtlpReceiverOptions): OtlpReceiver {
  const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port,
    async fetch(req) {
      const token = opts.token();
      if (!token || req.headers.get("authorization") !== `Bearer ${token}`) {
        return new Response("unauthorized", { status: 401 });
      }
      const path = new URL(req.url).pathname;
      if (path !== "/v1/logs" && path !== "/v1/metrics") {
        return new Response("not found", { status: 404 });
      }
      if (req.method !== "POST") return new Response("POST only", { status: 405 });
      const contentType = (req.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
      if (!TYPES.includes(contentType)) return new Response("unsupported type", { status: 415 });
      let body: Uint8Array;
      try {
        body = await readBody(req, max);
        if (req.headers.get("content-encoding") === "gzip") {
          body = gunzipSync(body, { maxOutputLength: max });
        }
      } catch (error) {
        if (error instanceof TooBig || error instanceof RangeError) {
          return new Response("too large", { status: 413 });
        }
        return new Response("bad body", { status: 400 });
      }
      let events: OtlpEvent[] = [];
      if (path === "/v1/logs") {
        try {
          events = decodeLogs(contentType, body);
        } catch (error) {
          if (!(error instanceof OtlpDecodeError)) throw error;
          return new Response(error.message, { status: 400 });
        }
        if (events.length > 0) opts.onEvents(events);
      }
      return contentType === "application/json"
        ? new Response("{}", { headers: { "content-type": "application/json" } })
        : new Response(new Uint8Array(), { headers: { "content-type": contentType } });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    port: server.port ?? 0,
    stop: () => server.stop(true),
  };
}
