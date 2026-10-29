import type { ServerWebSocket } from "bun";
import type { ExternalSessions, HookPayload } from "./external.ts";
import type { ExternalPermissions } from "./external-permissions.ts";

export interface ReceptorOptions {
  /** `hooks.port`; 0 picks a free one (tests and smokes). */
  port: number;
  /** `hooks.token`, read on every request so a new install takes effect without a restart. */
  token: () => string | null | undefined;
  external: ExternalSessions;
  /** Holds PermissionRequest for the app; without it every request is answered empty. */
  permissions?: ExternalPermissions;
  /** Sessions the daemon itself runs: their hooks (from the user's settings) are ignored. */
  isManaged: (claudeSessionId: string) => boolean;
}

export interface Receptor {
  url: string;
  port: number;
  /** Pushes a message to the channel of a launch; false when none is connected. */
  sendToLaunch(launchId: string, text: string): boolean;
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
    // Any later event of the session means a held request was answered in the terminal; the
    // permission_prompt notification is the terminal dialog itself, shown while the hook holds.
    const prompt = event === "Notification" && payload.notification_type === "permission_prompt";
    if (!prompt) opts.permissions?.closeSession(id);
    opts.external.apply(event, payload);
    if (event !== "PermissionRequest" || !opts.permissions) return empty();
    const answer = await opts.permissions.hold(payload, req.signal);
    return answer
      ? new Response(answer, { headers: { "content-type": "application/json" } })
      : empty();
  }

  /** Channel of each launch of `flightdeckd claude` connected right now. */
  const channels = new Map<string, ServerWebSocket<{ launch: string }>>();

  const server = Bun.serve<{ launch: string }>({
    hostname: "127.0.0.1",
    port: opts.port,
    // A held PermissionRequest waits for the app; Bun's default would close it after 10 s.
    idleTimeout: 0,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname === "/health") return Response.json({ ok: true });
      if (url.pathname === "/channel") {
        if (!authorized(req)) return new Response("unauthorized", { status: 401 });
        const launch = url.searchParams.get("launch") ?? "";
        const upgraded = srv.upgrade(req, { data: { launch } });
        return upgraded ? undefined : new Response("WebSocket esperado", { status: 426 });
      }
      const match = /^\/hooks\/([A-Za-z]+)$/.exec(url.pathname);
      if (match?.[1] && req.method === "POST") return hook(match[1], req);
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        channels.set(ws.data.launch, ws);
        opts.external.setChannel(ws.data.launch, true);
      },
      // One way: a channel that talks back is not ours.
      message(ws) {
        ws.close(1008, "canal só de ida");
      },
      close(ws) {
        if (channels.get(ws.data.launch) !== ws) return;
        channels.delete(ws.data.launch);
        opts.external.setChannel(ws.data.launch, false);
      },
    },
  });
  const port = server.port ?? opts.port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    sendToLaunch(launchId, text) {
      const channel = channels.get(launchId);
      if (!channel) return false;
      channel.send(JSON.stringify({ text }));
      return true;
    },
    stop: () => server.stop(true),
  };
}
