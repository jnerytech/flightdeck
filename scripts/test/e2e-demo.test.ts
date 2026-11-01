import { describe, expect, test } from "bun:test";
import {
  type DemoState,
  pidFile,
  stateFile,
  stopDemo,
  stopTree,
  waitForState,
} from "../lib/e2e-demo.ts";

const state = { url: "http://localhost:1420/", ids: { project: "p" } } as unknown as DemoState;

function recorder(platform: string, failKill = false) {
  const kills: Array<[number, string]> = [];
  const commands: string[][] = [];
  return {
    kills,
    commands,
    deps: {
      platform,
      kill: (pid: number, signal: string) => {
        kills.push([pid, signal]);
        if (failKill) throw Object.assign(new Error("gone"), { code: "ESRCH" });
      },
      run: (command: string[]) => void commands.push(command),
    },
  };
}

describe("stopping the demo tree (Vite and the fake hosts)", () => {
  test("on Linux and macOS the whole process group goes, first politely and then for good", () => {
    const r = recorder("linux");
    stopTree(4242, r.deps);
    expect(r.kills).toEqual([
      [-4242, "SIGTERM"],
      [-4242, "SIGKILL"],
    ]);
    expect(r.commands).toEqual([]);
  });

  test("a group that is already gone is not an error", () => {
    const r = recorder("linux", true);
    expect(() => stopTree(4242, r.deps)).not.toThrow();
  });

  test("on Windows taskkill takes the whole tree", () => {
    const r = recorder("win32");
    stopTree(4242, r.deps);
    expect(r.commands).toEqual([["taskkill", "/PID", "4242", "/T", "/F"]]);
    expect(r.kills).toEqual([]);
  });
});

describe("stopDemo: the teardown, which also runs when the setup failed halfway", () => {
  test("it kills the pid the setup recorded and removes both files", () => {
    const r = recorder("linux");
    const removed: string[] = [];
    const files = {
      read: (path: string) => (path === pidFile("d") ? "77\n" : null),
      remove: (path: string) => void removed.push(path),
    };
    expect(stopDemo("d", files, r.deps)).toBe(true);
    expect(r.kills[0]).toEqual([-77, "SIGTERM"]);
    expect(removed).toEqual([pidFile("d"), stateFile("d")]);
  });

  test("with no pid file nothing was started: nothing is killed", () => {
    const r = recorder("linux");
    const files = { read: () => null, remove: () => {} };
    expect(stopDemo("d", files, r.deps)).toBe(false);
    expect(r.kills).toEqual([]);
  });

  test("a pid file that holds no number is not trusted", () => {
    const r = recorder("linux");
    const files = { read: () => "oops", remove: () => {} };
    expect(stopDemo("d", files, r.deps)).toBe(false);
    expect(r.kills).toEqual([]);
  });
});

describe("waitForState: the demo says it is ready by writing its state file", () => {
  const clock = () => {
    let t = 0;
    return {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    };
  };

  test("it returns the state once the file holds it", async () => {
    let reads = 0;
    const { now, sleep } = clock();
    const got = await waitForState("d", 10_000, {
      read: () => (++reads < 3 ? null : JSON.stringify(state)),
      alive: () => true,
      now,
      sleep,
    });
    expect(got).toEqual(state);
    expect(reads).toBe(3);
  });

  test("a half-written file is read again", async () => {
    const answers = ['{"url":', JSON.stringify(state)];
    const { now, sleep } = clock();
    const got = await waitForState("d", 10_000, {
      read: () => answers.shift() ?? null,
      alive: () => true,
      now,
      sleep,
    });
    expect(got).toEqual(state);
  });

  test("a demo that died before it was ready is reported at once", async () => {
    const { now, sleep } = clock();
    await expect(
      waitForState("d", 10_000, { read: () => null, alive: () => false, now, sleep }),
    ).rejects.toThrow("o demo parou antes de ficar pronto");
  });

  test("a demo that never gets ready times out", async () => {
    const { now, sleep } = clock();
    await expect(
      waitForState("d", 1_000, { read: () => null, alive: () => true, now, sleep }),
    ).rejects.toThrow("o demo não ficou pronto em 1000 ms");
  });
});
