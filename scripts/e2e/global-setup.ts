/**
 * Starts the demo (`bun scripts/demo.ts --serve`: two fake hosts and Vite) in a process group of
 * its own, and waits for it to say it is ready. The pid is recorded right after the spawn, so the
 * teardown can stop the tree even when this setup fails halfway.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pidFile, waitForState } from "../lib/e2e-demo.ts";

export const STATE_DIR = join(tmpdir(), "flightdeck-e2e-demo");
const DEMO = resolve(import.meta.dirname, "../demo.ts");
const READY_MS = 180_000;

const read = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

export default async function globalSetup() {
  rmSync(STATE_DIR, { recursive: true, force: true });
  mkdirSync(STATE_DIR, { recursive: true });
  const child = spawn("bun", [DEMO, "--serve"], {
    env: { ...process.env, E2E_STATE_DIR: STATE_DIR },
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });
  writeFileSync(pidFile(STATE_DIR), String(child.pid));
  const state = await waitForState(STATE_DIR, READY_MS, {
    read,
    alive: () => !exited,
    sleep: (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
    now: Date.now,
  });
  process.env.E2E_DEMO_URL = state.url;
  process.env.E2E_DEMO_IDS = JSON.stringify(state.ids);
}
