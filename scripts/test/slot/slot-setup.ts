import type { SlotChild, SlotEnv, SlotHolder } from "../../lib/slot/index.ts";

export const PATH = "/tmp/flightdeck-slot.lock";
export const mine: SlotHolder = {
  pid: 10,
  label: "sonar",
  command: "bun run test",
  startedAt: 1000,
};
export const theirs: SlotHolder = {
  pid: 20,
  label: "kiwi",
  command: "bun run e2e",
  startedAt: 1000,
};

/** An in-memory slot: one lock "file", a fake clock that only moves when somebody sleeps. */
export function fake(
  opts: {
    files?: Record<string, string>;
    dead?: number[];
    child?: SlotChild;
    holder?: number;
  } = {},
) {
  const files = new Map(Object.entries(opts.files ?? {}));
  const logs: string[] = [];
  const sleeps: number[] = [];
  const terminated: number[] = [];
  const spawned: { command: string[]; nice: boolean }[] = [];
  const spawnedAsHolder: Array<boolean | undefined> = [];
  /** protect and spawn, in the order they were called. */
  const order: string[] = [];
  let time = 5000;
  let handler: ((code: number) => void) | null = null;
  const listeners = { off: 0 };
  const onSleep: ((n: number) => void)[] = [];
  const env: SlotEnv = {
    fs: {
      create: (p, d) => {
        if (files.has(p)) return false;
        files.set(p, d);
        return true;
      },
      read: (p) => files.get(p) ?? null,
      remove: (p) => {
        files.delete(p);
      },
      list: (prefix) => [...files.keys()].filter((name) => name.startsWith(prefix)),
    },
    path: PATH,
    pid: 10,
    label: "sonar",
    alive: (pid) => !(opts.dead ?? []).includes(pid),
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
      for (const f of onSleep) f(sleeps.length);
    },
    log: (line) => {
      logs.push(line);
    },
    ...(opts.holder !== undefined ? { holder: opts.holder } : {}),
    protect: () => {
      order.push("protect");
    },
    spawn: (command, nice, asHolder) => {
      order.push("spawn");
      spawned.push({ command, nice });
      spawnedAsHolder.push(asHolder);
      return opts.child ?? { wait: async () => 0, kill: () => {} };
    },
    terminate: (pid) => {
      terminated.push(pid);
    },
    onSignal: (h) => {
      handler = h;
      return () => {
        listeners.off += 1;
        handler = null;
      };
    },
  };
  return {
    env,
    files,
    logs,
    sleeps,
    spawned,
    spawnedAsHolder,
    order,
    terminated,
    listeners,
    onSleep,
    signal: (code: number) => handler?.(code),
  };
}

export const held = (h: SlotHolder) => JSON.stringify(h);

export const queued = (pid: number, label: string, startedAt: number, command = "bun run test") =>
  JSON.stringify({ pid, label, command, startedAt } satisfies SlotHolder);
