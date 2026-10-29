/**
 * Guard against reaching the Tauri shell from tests, above all the Rust executor of "Abrir no
 * terminal" (phase 8). `@tauri-apps/api` sends every `invoke` through
 * `window.__TAURI_INTERNALS__`, and the UI tests' DOM makes `window` the global object: the
 * sentinel installed there records each call and rejects it. Code under test takes an injected
 * executor; a call landing here means some path ran the real one.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { realTempDir } from "./temp-dir.ts";

export interface TauriGuard {
  /** One line per call: the command and its arguments. */
  log: string;
}

interface Bridge {
  __TAURI_INTERNALS__?: unknown;
}

export function installTauriGuard(scope: Bridge = globalThis as Bridge): TauriGuard {
  const log = join(realTempDir("fd-tauri-guard-"), "calls.log");
  scope.__TAURI_INTERNALS__ = {
    guard: true,
    invoke: async (cmd: string, args: unknown) => {
      appendFileSync(log, `${cmd} ${JSON.stringify(args ?? {})}\n`);
      throw new Error(`comando ${cmd} da casca Tauri chamado num teste`);
    },
    transformCallback: () => 0,
    unregisterCallback: () => {},
  };
  return { log };
}

/** Lines recorded by the sentinel; empty when nothing reached the Tauri shell. */
export function tauriCalls(guard: TauriGuard): string[] {
  return existsSync(guard.log) ? readFileSync(guard.log, "utf8").trim().split(/\r?\n/) : [];
}

export function assertNoTauriCalls(guard: TauriGuard): void {
  const calls = tauriCalls(guard);
  if (calls.length > 0) {
    throw new Error(`casca Tauri chamada ${calls.length} vez(es): ${calls.join(" | ")}`);
  }
}
