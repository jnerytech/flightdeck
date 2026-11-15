import { describe, expect, test } from "bun:test";
import {
  acquire,
  cancel,
  parseArgs,
  parseHolder,
  run,
  type SlotChild,
  type SlotHolder,
  USAGE,
} from "../../lib/slot/index.ts";

import { fake, held, mine, PATH, theirs } from "./slot-setup.ts";

describe("slot: running a command", () => {
  test("the command runs under the lock and its exit code comes back", async () => {
    const f = fake({ child: { wait: async () => 7, kill: () => {} } });
    f.env.spawn = (command, nice) => {
      f.spawned.push({ command, nice });
      expect(parseHolder(f.files.get(PATH) ?? null)?.command).toBe("bun run test");
      return { wait: async () => 7, kill: () => {} };
    };
    expect(await run(f.env, ["--nice", "bun", "run", "test"])).toBe(7);
    expect(f.spawned).toEqual([{ command: ["bun", "run", "test"], nice: true }]);
    expect(f.files.has(PATH)).toBe(false);
    expect(f.listeners.off).toBe(1);
  });

  test("the lock is released when the command fails to start", async () => {
    const f = fake();
    f.env.spawn = () => {
      throw new Error("ENOENT");
    };
    await expect(run(f.env, ["nope"])).rejects.toThrow("ENOENT");
    expect(f.files.has(PATH)).toBe(false);
    expect(f.listeners.off).toBe(1);
  });

  test("--status prints the holder and runs nothing", async () => {
    const f = fake({ files: { [PATH]: held(theirs) } });
    expect(await run(f.env, ["--status"])).toBe(0);
    expect(f.logs).toEqual(["held by kiwi: bun run e2e (pid 20, 4s)"]);
    expect(f.spawned).toEqual([]);
  });

  test("--status logs the holder and each waiter as lines of their own, since a log line is kept to one line (#372)", async () => {
    const f = fake({
      files: {
        [PATH]: held(theirs),
        [`${PATH}.wait.30`]: JSON.stringify({
          ...theirs,
          pid: 30,
          label: "userhome",
          startedAt: 2000,
        }),
      },
    });
    expect(await run(f.env, ["--status"])).toBe(0);
    expect(f.logs).toEqual([
      "held by kiwi: bun run e2e (pid 20, 4s)",
      "waiting 1: userhome: bun run e2e (pid 30, 3s); waits on kiwi (pid 20)",
    ]);
  });

  test("no command prints the usage and exits with 2", async () => {
    const f = fake();
    expect(await run(f.env, [])).toBe(2);
    expect(f.logs).toEqual([USAGE]);
  });

  test("a signal while the command runs stops it, releases, and returns the signal's code", async () => {
    let killed = false;
    let finish: (code: number) => void = () => {};
    const child: SlotChild = {
      wait: () => new Promise<number>((resolve) => (finish = resolve)),
      kill: () => {
        killed = true;
        finish(1);
      },
    };
    const f = fake({ child });
    const done = run(f.env, ["bun", "test"]);
    await Promise.resolve();
    await Promise.resolve();
    f.signal(130);
    expect(await done).toBe(130);
    expect(killed).toBe(true);
    expect(f.files.has(PATH)).toBe(false);
  });

  test("a signal while queued gives up the wait without ever running", async () => {
    const f = fake({ files: { [PATH]: held(theirs) } });
    f.onSleep.push(() => f.signal(143));
    expect(await run(f.env, ["bun", "test"])).toBe(143);
    expect(f.spawned).toEqual([]);
    expect(f.files.get(PATH)).toBe(held(theirs));
    expect(f.listeners.off).toBe(1);
  });
});

const waiter = (pid: number, label: string) =>
  JSON.stringify({ pid, label, command: "bun run test", startedAt: 2000 } satisfies SlotHolder);

describe("slot: cancel", () => {
  test("--cancel alone is the cancel; with anything else it is the usage", () => {
    expect(parseArgs(["--cancel"])).toEqual({ kind: "cancel" });
    expect(parseArgs(["--", "--cancel"])).toEqual({ kind: "cancel" });
    expect(parseArgs(["--cancel", "bun"])).toEqual({ kind: "usage" });
    expect(parseArgs(["--nice", "--cancel"])).toEqual({ kind: "usage" });
  });

  test("a waiter is recorded while it waits and forgotten when it stops", async () => {
    const { env, files, onSleep } = fake({ files: { [PATH]: held(theirs) } });
    let during: string[] = [];
    onSleep.push((n) => {
      during = [...files.keys()].filter((name) => name.startsWith(`${PATH}.wait.`));
      if (n === 1) files.delete(PATH);
    });
    expect(await acquire(env, "bun run test", () => false)).toBe(true);
    expect(during).toEqual([`${PATH}.wait.10`]);
    expect([...files.keys()].some((name) => name.includes(".wait."))).toBe(false);
  });

  test("the recorded waiter names this process, label and command", async () => {
    const { env, files, onSleep } = fake({ files: { [PATH]: held(theirs) } });
    let recorded: SlotHolder | null = null;
    onSleep.push(() => {
      recorded = parseHolder(files.get(`${PATH}.wait.10`) ?? null);
      files.delete(PATH);
    });
    await acquire(env, "bun run e2e", () => false);
    expect(recorded).toMatchObject({ pid: 10, label: "sonar", command: "bun run e2e" });
  });

  test("it stops the own label's waiters and holder, never another label's", () => {
    const { env, files, logs, terminated } = fake({
      files: {
        [PATH]: held({ ...mine, pid: 11 }),
        [`${PATH}.wait.12`]: waiter(12, "sonar"),
        [`${PATH}.wait.20`]: waiter(20, "kiwi"),
      },
    });
    expect(cancel(env)).toBe(0);
    expect(terminated.sort()).toEqual([11, 12]);
    expect(files.has(`${PATH}.wait.20`)).toBe(true);
    expect(logs.join("\n")).toContain("cancelled sonar: bun run test (pid 12,");
    expect(logs.join("\n")).not.toContain("kiwi");
  });

  test("it never stops itself, a dead process or a holder of another label", () => {
    const { env, files, logs, terminated } = fake({
      dead: [13],
      files: {
        [PATH]: held(theirs),
        [`${PATH}.wait.10`]: waiter(10, "sonar"),
        [`${PATH}.wait.13`]: waiter(13, "sonar"),
      },
    });
    expect(cancel(env)).toBe(0);
    expect(terminated).toEqual([]);
    expect(files.has(`${PATH}.wait.13`)).toBe(false);
    expect(logs).toEqual(["nothing to cancel for sonar"]);
  });

  test("an unreadable waiter file is ignored and removed", () => {
    const { env, files, terminated } = fake({ files: { [`${PATH}.wait.14`]: "{broken" } });
    expect(cancel(env)).toBe(0);
    expect(terminated).toEqual([]);
    expect(files.has(`${PATH}.wait.14`)).toBe(false);
  });

  test("run with --cancel cancels", async () => {
    const { env, logs } = fake();
    expect(await run(env, ["--cancel"])).toBe(0);
    expect(logs).toEqual(["nothing to cancel for sonar"]);
  });
});
