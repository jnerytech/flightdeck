import { z } from "zod";
import { parseJsonWith } from "../../kernel/index.ts";

/** One Claude Code event (an OTLP log record) in the shape the daemon keeps. */
export interface OtlpEvent {
  /** Without the `claude_code.` prefix: `tool_result`, `api_request`... */
  name: string;
  timeMs: number;
  sessionId: string;
  promptId: string | null;
  attrs: Record<string, string | number | boolean>;
}

export class OtlpDecodeError extends Error {}

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

/** A time in nanoseconds as the JSON writes it (a number or a string of digits). */
function parseNanos(value: unknown): bigint {
  try {
    return BigInt(String(value));
  } catch {
    throw new OtlpDecodeError("a time that is not a number");
  }
}

function decodeJson(text: string): OtlpEvent[] {
  let root: unknown;
  try {
    root = parseJsonWith(z.unknown(), text);
  } catch {
    throw new OtlpDecodeError("JSON that does not parse");
  }
  const events: OtlpEvent[] = [];
  for (const rl of list(obj(root).resourceLogs)) {
    const resource = jsonAttrs(obj(obj(rl).resource).attributes);
    for (const sl of list(obj(rl).scopeLogs)) {
      for (const lr of list(obj(sl).logRecords)) {
        const rec = obj(lr);
        const nanos = parseNanos(rec.timeUnixNano ?? rec.observedTimeUnixNano ?? 0);
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

/** A position in a protobuf message; every read moves it and refuses to go past the end. */
class ProtoReader {
  private pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  get done(): boolean {
    return this.pos >= this.buf.length;
  }

  varint(): bigint {
    let result = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      const byte = this.buf[this.pos++];
      if (byte === undefined) throw new OtlpDecodeError("protobuf cut short");
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return result;
    }
    throw new OtlpDecodeError("protobuf varint too long");
  }

  /** The next `length` bytes, moving past them. */
  take(length: number): Uint8Array {
    if (this.pos + length > this.buf.length) throw new OtlpDecodeError("protobuf cut short");
    const bytes = this.buf.subarray(this.pos, this.pos + length);
    this.pos += length;
    return bytes;
  }
}

/** The value of one field by its wire type; null for a 32-bit value, which is skipped. */
function readValue(reader: ProtoReader, wire: number): bigint | Uint8Array | null {
  if (wire === 0) return reader.varint();
  if (wire === 1) {
    const bytes = reader.take(8);
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true);
  }
  if (wire === 2) return reader.take(Number(reader.varint()));
  if (wire === 5) {
    reader.take(4);
    return null;
  }
  throw new OtlpDecodeError("protobuf wire type not supported");
}

function readFields(buf: Uint8Array): Field[] {
  const fields: Field[] = [];
  const reader = new ProtoReader(buf);
  while (!reader.done) {
    const key = Number(reader.varint());
    const num = key >>> 3;
    const wire = key & 7;
    if (num === 0) throw new OtlpDecodeError("protobuf field 0");
    const value = readValue(reader, wire);
    if (value !== null) fields.push({ num, wire, value });
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

/** One `LogRecord`: its attributes, its body and its time (the observed time when it has none). */
function logRecordEvent(lr: Uint8Array, resource: ReturnType<typeof protoAttrs>): OtlpEvent | null {
  const fields = readFields(lr);
  const time = fields.find((f) => f.num === 1 && typeof f.value === "bigint")?.value;
  const observed = fields.find((f) => f.num === 11 && typeof f.value === "bigint")?.value;
  const body = bytesOf(fields, 5)[0];
  const stamp = [time, observed].find((value) => typeof value === "bigint") ?? 0n;
  return toEvent(
    protoAttrs(bytesOf(fields, 6)),
    resource,
    body ? protoValue(body) : undefined,
    nanosToMs(stamp),
  );
}

function decodeProtobuf(buf: Uint8Array): OtlpEvent[] {
  const events: OtlpEvent[] = [];
  for (const rl of bytesOf(readFields(buf), 1)) {
    const rlFields = readFields(rl);
    const resourceBytes = bytesOf(rlFields, 1)[0];
    const resource = protoAttrs(resourceBytes ? bytesOf(readFields(resourceBytes), 1) : []);
    for (const sl of bytesOf(rlFields, 2)) {
      for (const lr of bytesOf(readFields(sl), 2)) {
        const event = logRecordEvent(lr, resource);
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
