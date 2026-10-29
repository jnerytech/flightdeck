import type { ExternalSessions, HookPayload } from "./external.ts";

export interface ReceptorOptions {
  /** `hooks.port`; 0 picks a free one (tests and smokes). */
  port: number;
  /** `hooks.token`, read on every request so a new install takes effect without a restart. */
  token: () => string | null | undefined;
  external: ExternalSessions;
  /** Sessions the daemon itself runs: their hooks (from the user's settings) are ignored. */
  isManaged: (claudeSessionId: string) => boolean;
}

export interface Receptor {
  url: string;
  port: number;
  stop(): Promise<void>;
}

/** "Nothing to decide": the hook returns at once and Claude carries on as if it did not exist. */
const empty = () => new Response("", { status: 200 });

/**
 * HTTP listener for Claude Code hooks, always on 127.0.0.1 (hooks run on this machine), apart
 * from the protocol's `bind`. Its own token, accepted only on the hook routes.
 */
export function startReceptor(opts: ReceptorOptions): Receptor {
  /** Flagged by the SessionStart command (FLIGHTDECK_MANAGED=1) before session.init names them. */
  const managed = new Set<string>();

  const authorized = (req: Request) => {
    const token = opts.token();
    return Boolean(token) && req.headers.get("authorization") === `Bearer ${token}`;
  };

  async function hook(event: string, req: Request): Promise<Response> {
    if (!authorized(req)) return new Response("unauthorized", { status: 401 });
    let payload: HookPayload;
    try {
      payload = (await req.json()) as HookPayload;
    } catch {
      return new Response("JSON inválido", { status: 400 });
    }
    const id = typeof payload.session_id === "string" ? payload.session_id : "";
    if (payload.managed === true) managed.add(id);
    if (managed.has(id) || opts.isManaged(id)) return empty();
    opts.external.apply(event, payload);
    return empty();
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port,
    // A held PermissionRequest waits for the app; Bun's default would close it after 10 s.
    idleTimeout: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/health") return Response.json({ ok: true });
      const match = /^\/hooks\/([A-Za-z]+)$/.exec(url.pathname);
      if (match?.[1] && req.method === "POST") return hook(match[1], req);
      return new Response("not found", { status: 404 });
    },
  });
  const port = server.port ?? opts.port;
  return { url: `http://127.0.0.1:${port}`, port, stop: () => server.stop(true) };
}
