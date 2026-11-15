import {
  TerminalManager,
  type TerminalManagerOptions,
} from "../../src/terminal/terminal-manager.ts";
import { workspace } from "../support/helpers.ts";
import { dataOf, fakePtys } from "../support/pty-helpers.ts";
import { manualTime } from "../support/time-helpers.ts";

export const TOKEN = "terminal-token-0123456789abcdef";
export const MB = 1024 * 1024;
export const MIN = 60_000;
export const cleanups: Array<() => unknown> = [];
/** The afterEach of every terminal-daemon file: stops what the test started, last first. */
export async function teardown() {
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

/** A manager over fake PTYs and a manual clock, on a Linux host with zsh. */
export function setup(overrides: Partial<TerminalManagerOptions> = {}) {
  const { root, project } = workspace();
  const ptys = fakePtys();
  const time = manualTime();
  const logs: string[] = [];
  const manager = new TerminalManager({
    pty: ptys.factory,
    allowedRoots: [root],
    platform: "linux",
    env: () => ({ SHELL: "/bin/zsh", PATH: "/bin", ANTHROPIC_API_KEY: "sk-secreta", EXTRA: "1" }),
    which: (name) => (name === "bash" ? "/usr/bin/bash" : null),
    timers: time.timers,
    now: time.now,
    log: (message) => logs.push(message),
    ...overrides,
  });
  cleanups.push(() => manager.stop());
  const open = () => manager.open({ cwd: project, cols: 80, rows: 24 });
  return { manager, ptys, time, logs, project, root, open };
}

export const code = async (fn: () => unknown) => {
  try {
    await fn();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? "sem código";
  }
};

export const text = (frames: Parameters<typeof dataOf>[0]) => dataOf(frames).toString("utf8");
