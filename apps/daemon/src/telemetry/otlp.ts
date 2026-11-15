import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { tokenMatches } from "../kernel/index.ts";
import { decodeLogs, OtlpDecodeError, type OtlpEvent } from "./domain/otlp-decode.ts";

const inflate = promisify(gunzip);

export interface OtlpReceiverOptions {
  /** 0 picks a free port (tests and smokes). */
  port: number;
  /** The receiver's own token, read on every request; none installed means every request is refused. */
  token: () => string | null | undefined | Promise<string | null | undefined>;
  /** The gzip decompressor; the async zlib one when absent. */
  inflate?: (body: Uint8Array, options: { maxOutputLength: number }) => Promise<Uint8Array>;
  /** Largest body, before and after gunzip, in bytes. */
  maxBytes?: number;
  onEvents: (events: OtlpEvent[]) => void;
}

export interface OtlpReceiver {
  url: string;
  port: number;
  stop(): Promise<void>;
}

const DEFAULT_MAX_BYTES = 1024 * 1024;

// ---- receiver ------------------------------------------------------------------------------

const TYPES = new Set(["application/json", "application/x-protobuf"]);

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

/** The refusal for a request that may not be read, or the path and type of one that may. */
async function admit(
  req: Request,
  opts: OtlpReceiverOptions,
): Promise<Response | { path: string; contentType: string }> {
  const token = await opts.token();
  if (!token || !tokenMatches(`Bearer ${token}`, req.headers.get("authorization") ?? "")) {
    return new Response("unauthorized", { status: 401 });
  }
  const path = new URL(req.url).pathname;
  if (path !== "/v1/logs" && path !== "/v1/metrics") {
    return new Response("not found", { status: 404 });
  }
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const contentType = (req.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!TYPES.has(contentType)) return new Response("unsupported type", { status: 415 });
  return { path, contentType };
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
      const admitted = await admit(req, opts);
      if (admitted instanceof Response) return admitted;
      const { path, contentType } = admitted;
      let body: Uint8Array;
      try {
        body = await readBody(req, max);
        if (req.headers.get("content-encoding") === "gzip") {
          body = await (opts.inflate ?? inflate)(body, { maxOutputLength: max });
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
