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
  /** What `vault.report` and `vault.decisions` answer (phase 19). */
  const audit = { rows: [] as unknown[], csv: "", decisions: [] as unknown[] };
  /** What `messages.list` answers (phase 21); the payloads asked are in `commands`. */
  /** Phase 21: the hub's lists and the host's standard names, when a test fills them. */
  const hub = { managed: [] as unknown[], names: [] as unknown[] };
  /** The events each session has, by id: `session.subscribe` replays what is after `sinceSeq`. */
  const streams: Record<string, Array<{ seq: number; event: unknown }>> = {};
  const messaging = {
    policy: { exceptions: [] } as Record<string, unknown>,
    paused: [] as string[],
    teams: [] as unknown[],
    messages: [] as unknown[],
    sessions: [] as unknown[],
    send: { id: "m-sent", status: "queued", reason: null } as unknown,
  };
  /** Phase 23: what `telemetry.session` and `telemetry.summary` answer. */
  const telemetry = {
    session: { prompts: [] as unknown[] },
    summary: { projects: [] as unknown[] },
  };
  /** Phase 22: what `watch.get`, `watch.set` and `watch.describe` answer, for a test to set. */
  const watch = {
    info: { cardId: "", enabled: false, status: "watching", reason: null, rounds: [] } as {
      cardId: string;
      enabled: boolean;
      status: string;
      reason: string | null;
      rounds: unknown[];
    },
    describe: { text: "", redacted: 0 },
    card: {} as unknown,
    /** What `watch.byUrl` answers. */
    byUrl: { via: "none", trace: null, sessions: [] } as unknown,
    /** The projects `project.list` gives, and the watch settings `watch.settings` keeps per one. */
    projects: [] as unknown[],
    settings: {
      enabled: false,
      maxRounds: 3,
      checks: [] as string[],
      checkTimeoutMin: 10,
      budgetUsd: 5 as number | null,
      maxTurns: 30 as number | null,
      persona: "revisor",
      maxFailures: 2,
      dailyUsd: 20 as number | null,
    },
  };
  /** What `vault.rules.preview` answers (phase 19). */
  const preview = {
    verdict: {
      decision: "ask",
      ruleId: null as string | null,
      reason: "padrão",
      once: false,
      needsHold: false,
      limited: false,
    },
  };
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
          "project.list": { projects: watch.projects, maxParallelRuns: 2 },
        };
        if (type in known) return ack(known[type]);
        if (type === "session.list") return ack({ sessions: hub.managed });
        if (type === "session.subscribe") {
          const ask = payload as { sessionId: string; sinceSeq?: number };
          const events = (streams[ask.sessionId] ?? []).filter((e) => e.seq > (ask.sinceSeq ?? 0));
          const last = streams[ask.sessionId]?.at(-1)?.seq ?? 0;
          ack({
            session: {
              id: ask.sessionId,
              name: null,
              cwd: "/w",
              status: "idle",
              permissionMode: "default",
              model: null,
              claudeSessionId: null,
              lastSeq: last,
              createdAt: "2026-10-31T12:00:00.000Z",
              updatedAt: "2026-10-31T12:00:00.000Z",
            },
            replayed: events.length,
          });
          for (const e of events) {
            ws.send(
              JSON.stringify({
                type: "event",
                sessionId: ask.sessionId,
                seq: e.seq,
                ts: "2026-10-31T12:00:00.000Z",
                event: e.event,
              }),
            );
          }
          return;
        }
        if (type === "names.list") return ack({ names: hub.names });
        if (type === "vault.deliver") return ack({ expiresAt: 0 });
        // Phase 19: the approval of a request that asked, before its delivery.
        if (type === "vault.approve") return ack();
        if (type === "vault.rules.preview") return ack(preview.verdict);
        if (type === "telemetry.session") return ack(telemetry.session);
        if (type === "telemetry.summary") return ack(telemetry.summary);
        if (type === "messages.list") return ack({ messages: messaging.messages });
        if (type === "messages.sessions") return ack({ sessions: messaging.sessions });
        if (type === "messaging.rules.get") {
          return ack({ policy: messaging.policy, paused: messaging.paused });
        }
        if (type === "messaging.rules.set") {
          const set = payload as { policy: Record<string, unknown>; unpause?: string[] };
          messaging.policy = set.policy;
          messaging.paused = messaging.paused.filter((p) => !(set.unpause ?? []).includes(p));
          return ack({ policy: messaging.policy, paused: messaging.paused });
        }
        if (type === "watch.get")
          return ack({ ...watch.info, cardId: (payload as { cardId: string }).cardId });
        if (type === "watch.set") {
          const set = payload as { cardId: string; enabled: boolean | null };
          watch.info = {
            ...watch.info,
            cardId: set.cardId,
            enabled: set.enabled === true,
            status: "watching",
            reason: null,
          };
          return ack(watch.info);
        }
        if (type === "watch.describe") return ack(watch.describe);
        if (type === "watch.settings") {
          const { patch } = payload as { patch?: Partial<typeof watch.settings> };
          if (patch) watch.settings = { ...watch.settings, ...patch };
          return ack(watch.settings);
        }
        if (type === "watch.byUrl") return ack(watch.byUrl);
        if (type === "card.get") return ack(watch.card);
        if (type === "card.pr.create") return ack(watch.card);
        if (type === "teams.list") return ack({ teams: messaging.teams });
        if (type === "teams.status") {
          const team = messaging.teams.find(
            (t) => (t as { id: string }).id === (payload as { team: string }).team,
          );
          return ack({ team, members: [], messages: 0 });
        }
        if (type === "messages.send") return ack(messaging.send);
        if (type === "messages.directory") return ack({ host: "h", sessions: [] });
        if (type === "messages.peers") return ack();
        if (type === "vault.report") {
          const csv = (payload as { format?: string }).format === "csv";
          return ack({ rows: audit.rows, ...(csv ? { csv: audit.csv } : {}) });
        }
        if (type === "vault.decisions") return ack({ decisions: audit.decisions });
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
    hub,
    refuse,
    features,
    preview,
    audit,
    streams,
    watch,
    messaging,
    telemetry,
    /** Sends a frame to every connected client, as the daemon does on its own. */
    push: (frame: unknown) => {
      for (const ws of sockets) ws.send(JSON.stringify(frame));
    },
  };
}
