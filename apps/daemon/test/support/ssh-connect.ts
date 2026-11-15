import { SshConnector } from "../../src/ssh/connect.ts";
import { HostKeys } from "../../src/ssh/hostkey.ts";
import type { DeliveredKey } from "../../src/ssh/key-delivery.ts";
import { SshTargets } from "../../src/ssh/targets.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { TerminalManager } from "../../src/terminal/terminal-manager.ts";
import { tempDir } from "./helpers.ts";
import { fakePtys } from "./pty-helpers.ts";
import { manualTime } from "./time-helpers.ts";

/** What a test registers to be undone; the test file empties it after each test. */
export const cleanups: Array<() => unknown> = [];
export async function drainCleanups(): Promise<void> {
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

// Keys generated for the tests; never one of the user's.
export const KEY =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPHyii7r5lIz9AQ/c2vlfTxoKQtFoDLtWtwxRY/fF9Fl";

export const scan = (host: string, key: string) => ({ code: 0, stdout: `${host} ${key}\n` });

export interface SetupOptions {
  platform?: NodeJS.Platform;
  dir?: string;
  askpass?: boolean;
}

export function setup(options: SetupOptions = {}) {
  const dir = options.dir ?? tempDir();
  const store = new EventStore(":memory:");
  const targets = new SshTargets({ db: store.db });
  // What each host answers to ssh-keyscan; a host that is not here is unreachable.
  const servers = new Map<string, { code: number; stdout: string }>();
  const hostKeys = new HostKeys({
    targets,
    exec: async (cmd) => servers.get(cmd.at(-1) as string) ?? { code: 1, stdout: "" },
  });
  const time = manualTime();
  const ptys = fakePtys();
  const logs: string[] = [];
  const terminals = new TerminalManager({
    pty: ptys.factory,
    allowedRoots: [],
    platform: "linux",
    env: () => ({ PATH: "/bin" }),
    timers: time.timers,
    now: time.now,
    log: (line) => logs.push(line),
  });
  cleanups.push(() => terminals.stop());
  const runs: Array<{ argv: string[]; env: Record<string, string> }> = [];
  let reply = { code: 0, stderr: "" };
  const delivered: Array<{ key: string; cleaned: number }> = [];
  const tickets: Array<[string, string]> = [];
  const connector = new SshConnector({
    targets,
    hostKeys,
    terminals,
    dir,
    platform: options.platform ?? "linux",
    sshPath: "/usr/bin/ssh",
    timers: time.timers,
    run: async (argv, env) => {
      runs.push({ argv, env });
      return reply;
    },
    delivery: {
      kind: "agent",
      deliver: async (key): Promise<DeliveredKey> => {
        const record = { key, cleaned: 0 };
        delivered.push(record);
        return {
          identityFile: null,
          env: { SSH_AUTH_SOCK: "/tmp/fd-test.sock" },
          cleanup: () => {
            record.cleaned++;
          },
        };
      },
    },
    ...(options.askpass === false
      ? {}
      : {
          askpass: {
            script: "/data/ssh/askpass.sh",
            configFile: "/home/u/.flightdeck/config.json",
            ticket: (target: { name: string }, kind: string) => {
              tickets.push([target.name, kind]);
              return "ticket-1";
            },
          },
        }),
  });
  cleanups.push(() => connector.stop());
  const bastion = targets.save({ name: "bastion", host: "bastion.example.com", user: "jump" });
  const inner = targets.save({ name: "inner", host: "10.0.0.9", user: "ana", jump: bastion.id });
  const vps = targets.save({
    name: "vps",
    host: "vps.example.com",
    user: "deploy",
    port: 2222,
  });
  const pin = (id: string, key = KEY) =>
    targets.pin(id, { fingerprint: `SHA256:${id.slice(-6)}`, keys: [key] });
  for (const t of [bastion, inner, vps]) {
    pin(t.id);
    servers.set(t.host, scan(t.host, KEY));
  }
  return {
    dir,
    targets,
    terminals,
    connector,
    ptys,
    time,
    logs,
    delivered,
    tickets,
    servers,
    runs,
    answer: (code: number, stderr = "") => {
      reply = { code, stderr };
    },
    pin,
    bastion,
    inner,
    vps,
    open: (id: string, extra: { privateKey?: string } = {}) =>
      connector.connect({ targetId: id, cols: 100, rows: 30, ...extra }),
    probe: (id: string, extra: { privateKey?: string } = {}) =>
      connector.test({ targetId: id, ...extra }),
  };
}
