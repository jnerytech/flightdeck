/** A hand-made OTLP/protobuf encoder for `ExportLogsServiceRequest`, just enough for the tests. */

const enc = new TextEncoder();

function varint(n: bigint | number): number[] {
  let v = BigInt(n);
  const out: number[] = [];
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
}

const tag = (field: number, wire: number) => varint((field << 3) | wire);
const bytes = (field: number, data: number[] | Uint8Array) => [
  ...tag(field, 2),
  ...varint(data.length),
  ...data,
];
const str = (field: number, s: string) => bytes(field, enc.encode(s));

export type AnyValue = string | number | boolean;

function anyValue(v: AnyValue): number[] {
  if (typeof v === "string") return str(1, v);
  if (typeof v === "boolean") return [...tag(2, 0), v ? 1 : 0];
  if (Number.isInteger(v)) return [...tag(3, 0), ...varint(BigInt(v))];
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, v, true);
  return [...tag(4, 1), ...new Uint8Array(buf.buffer)];
}

const keyValue = (key: string, v: AnyValue) => [...str(1, key), ...bytes(2, anyValue(v))];

export interface TestRecord {
  name: string;
  timeMs: number;
  attrs: Record<string, AnyValue>;
}

export function protobufLogs(records: TestRecord[], resource: Record<string, AnyValue> = {}) {
  const logRecords = records.flatMap((r) => {
    const time = new DataView(new ArrayBuffer(8));
    time.setBigUint64(0, BigInt(r.timeMs) * 1_000_000n, true);
    const body = [
      ...tag(1, 1),
      ...new Uint8Array(time.buffer),
      ...bytes(5, anyValue(`claude_code.${r.name}`)),
      ...Object.entries({ "event.name": `claude_code.${r.name}`, ...r.attrs }).flatMap(([k, v]) =>
        bytes(6, keyValue(k, v)),
      ),
    ];
    return bytes(2, body);
  });
  const res = Object.entries(resource).flatMap(([k, v]) => bytes(1, keyValue(k, v)));
  const resourceLogs = [...bytes(1, res), ...bytes(2, logRecords)];
  return new Uint8Array(bytes(1, resourceLogs));
}

const jsonValue = (v: AnyValue) =>
  typeof v === "string"
    ? { stringValue: v }
    : typeof v === "boolean"
      ? { boolValue: v }
      : Number.isInteger(v)
        ? { intValue: String(v) }
        : { doubleValue: v };

export function jsonLogs(records: TestRecord[], resource: Record<string, AnyValue> = {}) {
  return JSON.stringify({
    resourceLogs: [
      {
        resource: {
          attributes: Object.entries(resource).map(([key, v]) => ({ key, value: jsonValue(v) })),
        },
        scopeLogs: [
          {
            logRecords: records.map((r) => ({
              timeUnixNano: String(BigInt(r.timeMs) * 1_000_000n),
              body: { stringValue: `claude_code.${r.name}` },
              attributes: Object.entries({ "event.name": `claude_code.${r.name}`, ...r.attrs }).map(
                ([key, v]) => ({ key, value: jsonValue(v) }),
              ),
            })),
          },
        ],
      },
    ],
  });
}
