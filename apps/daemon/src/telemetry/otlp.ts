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

/** Content a person typed or the model wrote: never kept, even when an exporter sends it. */
export const CONTENT_ATTRS: readonly string[] = [];

/** Decodes an `ExportLogsServiceRequest` in JSON or protobuf. */
export function decodeLogs(_contentType: string, _body: Uint8Array): OtlpEvent[] {
  return [];
}

export function startOtlpReceiver(opts: OtlpReceiverOptions): OtlpReceiver {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port,
    fetch: () => new Response("not implemented", { status: 500 }),
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    port: server.port ?? 0,
    stop: () => server.stop(true),
  };
}
