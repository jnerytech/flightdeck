import type {
  SshHostKeyCheck,
  SshImportEntry,
  SshTarget,
  SshTestResult,
} from "@flightdeck/protocol";

export interface SshDaemonOptions {
  targets?: SshTarget[];
  hostKey?: SshHostKeyCheck;
  test?: SshTestResult;
  importEntries?: SshImportEntry[];
  /** The daemon announces `ssh` in `host.info`. */
  feature?: boolean;
}

/** A target as the daemon stores it, with the defaults `ssh.save` fills in. */
export function sshTarget(extra: Partial<SshTarget> & { id: string; name: string }): SshTarget {
  return {
    host: `${extra.name}.example.com`,
    port: 22,
    user: "deploy",
    viaHost: null,
    auth: "agent",
    secretRef: null,
    jump: null,
    options: {},
    tags: [],
    hostKey: null,
    createdAt: "2026-10-29T12:00:00.000Z",
    updatedAt: "2026-10-29T12:00:00.000Z",
    ...extra,
  };
}

/**
 * A phase 15 daemon as far as the app can tell: `host.info` announcing `ssh`, and the `ssh.*`
 * commands over an in-memory list. `commands` is every command it got, with its payload.
 */
export function sshDaemon(cleanups: Array<() => unknown>, options: SshDaemonOptions = {}) {
  const targets = [...(options.targets ?? [])];
  const commands: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const state = {
    hostKey:
      options.hostKey ??
      ({ status: "pinned", fingerprint: "SHA256:abc", pinned: "SHA256:abc" } as SshHostKeyCheck),
    test: options.test ?? ({ ok: true, error: null } as SshTestResult),
  };
  let seq = 0;
  type Answer = { data?: unknown } | { error: { code: string; message: string } };
  const answer = (type: string, payload: Record<string, unknown>): Answer => {
    const ack = (data?: unknown): Answer => ({ data });
    const fail = (code: string, message: string): Answer => ({ error: { code, message } });
    const find = (targetId: unknown) => targets.find((t) => t.id === targetId);
    switch (type) {
      case "hello":
        return ack({
          hostName: "pc",
          daemonVersion: "0.15.0",
          protocolVersion: 1,
          allowedRoots: [],
        });
      case "host.info":
        return ack({
          hostName: "pc",
          os: "linux",
          arch: "x64",
          daemonVersion: "0.15.0",
          claudeVersion: null,
          claudePath: null,
          uptimeSec: 1,
          activeSessions: 0,
          apiKeySanitized: true,
          features: options.feature === false ? [] : ["ssh"],
        });
      case "hooks.status":
        return ack({ status: "absent", settingsPath: "/s.json" });
      case "project.list":
        return ack({ projects: [], maxParallelRuns: 2 });
      case "ssh.list":
        return ack({ targets });
      case "ssh.save": {
        const existing = find(payload.id);
        const next = sshTarget({
          ...(existing ?? {}),
          ...payload,
          id: existing?.id ?? `n${++seq}`,
          name: String(payload.name),
          updatedAt: "2026-10-30T12:00:00.000Z",
        } as Partial<SshTarget> & { id: string; name: string });
        if (existing) targets[targets.indexOf(existing)] = next;
        else targets.push(next);
        return ack(next);
      }
      case "ssh.remove": {
        if (payload.confirm !== true) return fail("invalid_state", "confirm");
        const at = targets.findIndex((t) => t.id === payload.id);
        if (at >= 0) targets.splice(at, 1);
        return ack();
      }
      case "ssh.hostkey.check":
        return ack(state.hostKey);
      case "ssh.hostkey.confirm": {
        const target = find(payload.targetId);
        if (target) target.hostKey = String(payload.fingerprint);
        return ack(target);
      }
      case "ssh.hostkey.forget": {
        const target = find(payload.targetId);
        if (target) target.hostKey = null;
        return ack(target);
      }
      case "ssh.connect":
        return ack({
          terminalId: "term-ssh-1",
          cwd: "/",
          command: "ssh",
          startedAt: "2026-10-30T12:00:00.000Z",
          attached: 0,
          cols: 80,
          rows: 24,
          exitCode: null,
          launchId: null,
        });
      case "ssh.test":
        return ack(state.test);
      case "ssh.import.preview":
        return ack({ entries: options.importEntries ?? [] });
      case "ssh.import.apply": {
        const aliases = (payload.aliases as string[]) ?? [];
        const created = aliases.map((alias) => {
          const entry = (options.importEntries ?? []).find((e) => e.alias === alias);
          const target = sshTarget({
            id: `n${++seq}`,
            name: alias,
            host: entry?.host ?? alias,
            port: entry?.port ?? 22,
            user: entry?.user ?? "deploy",
          });
          targets.push(target);
          return target;
        });
        return ack({ created, skipped: [] });
      }
      default:
        if (type.endsWith(".watch")) return ack();
        return fail("bad_request", `desconhecido: ${type}`);
    }
  };
  const server = Bun.serve({
    port: 0,
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response("", { status: 426 })),
    websocket: {
      message(ws, raw): void {
        const { id, type, payload = {} } = JSON.parse(String(raw));
        commands.push({ type, payload });
        const out = answer(type, payload);
        ws.send(
          JSON.stringify(
            "error" in out
              ? { type: "ack", id, ok: false, error: out.error }
              : { type: "ack", id, ok: true, data: out.data },
          ),
        );
      },
    },
  });
  cleanups.push(() => server.stop(true));
  return {
    url: `ws://127.0.0.1:${server.port}/`,
    commands,
    targets,
    state,
    /** The commands of one type, in order. */
    sent: (type: string) => commands.filter((c) => c.type === type).map((c) => c.payload),
  };
}
