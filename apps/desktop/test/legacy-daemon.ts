/**
 * A phase 6 daemon as far as the app can tell: `hello` and a `host.info` without `features`,
 * the hooks status, and an empty board. Any phase 7 command (`quota.*`, `usage.*`, `rules.*`) is
 * unknown, as it would be there.
 */
export function legacyDaemon(cleanups: Array<() => unknown>) {
  const asked: string[] = [];
  /** Every command with its payload, in order. */
  const commands: Array<{ type: string; payload: unknown }> = [];
  const sockets = new Set<{ send(data: string): unknown }>();
  /** Commands the test makes this daemon refuse, with the message it answers. */
  const refuse = new Map<string, string>();
  /** Features `host.info` announces (a phase 6 daemon announces none). */
  const features: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("", { status: 426 })),
    websocket: {
      open: (ws) => void sockets.add(ws),
      close: (ws) => void sockets.delete(ws),
      message(ws, raw) {
        const { id, type, payload } = JSON.parse(String(raw));
        asked.push(type);
        commands.push({ type, payload });
        const ack = (data?: unknown) => {
          ws.send(JSON.stringify({ type: "ack", id, ok: true, data }));
        };
        const refused = refuse.get(type);
        if (refused !== undefined) {
          ws.send(
            JSON.stringify({
              type: "ack",
              id,
              ok: false,
              error: { code: "bad_request", message: refused },
            }),
          );
          return;
        }
        const known: Record<string, unknown> = {
          hello: { hostName: "h", daemonVersion: "0.6.0", protocolVersion: 1, allowedRoots: [] },
          "host.info": {
            hostName: "h",
            os: "linux",
            arch: "x64",
            daemonVersion: "0.6.0",
            claudeVersion: null,
            claudePath: null,
            uptimeSec: 1,
            activeSessions: 0,
            apiKeySanitized: true,
            ...(features.length > 0 ? { features } : {}),
          },
          "hooks.status": { status: "absent", settingsPath: "/s.json" },
          "project.list": { projects: [], maxParallelRuns: 2 },
        };
        if (type in known) return ack(known[type]);
        if (type === "vault.deliver") return ack({ expiresAt: 0 });
        // Phase 19: the approval of a request that asked, before its delivery.
        if (type === "vault.approve") return ack();
        if (type === "vault.rules.set")
          return ack({ rules: (payload as { rules: unknown[] }).rules.length });
        if (type.endsWith(".watch")) return ack();
        ws.send(
          JSON.stringify({
            type: "ack",
            id,
            ok: false,
            error: { code: "bad_request", message: `desconhecido: ${type}` },
          }),
        );
      },
    },
  });
  cleanups.push(() => server.stop(true));
  return {
    url: `ws://127.0.0.1:${server.port}/`,
    asked,
    commands,
    refuse,
    features,
    /** Sends a frame to every connected client, as the daemon does on its own. */
    push: (frame: unknown) => {
      for (const ws of sockets) ws.send(JSON.stringify(frame));
    },
  };
}
