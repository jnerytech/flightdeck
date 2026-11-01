/**
 * Fake `claude` for the wrapper tests and smoke:central: a folder put first on PATH (ahead of the
 * claude guard's sentinel) with a `claude` script and a `claude.cmd`, both forwarding to
 * fake-claude-main.ts, which plays a hand-written script of hooks (command hooks through Claude
 * Code's shell, see hook-shell.ts), transcript lines and channel
 * messages. Payloads follow the proof of concept (docs/SPEC-fase-5.md).
 */
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { realTempDir } from "../../../scripts/test/temp-dir.ts";

export type FakeClaudeStep =
  | { do: "session-start"; sessionId: string; source?: string }
  | { do: "hook"; event: string; payload?: Record<string, unknown> }
  | { do: "transcript"; text: string }
  /** Starts the MCP server from --mcp-config and logs its notifications. */
  | { do: "channel" }
  | { do: "wait-channel"; count: number; timeoutMs?: number }
  /** Edits or creates a file under the session's cwd, like a turn's Write. */
  | { do: "write"; path: string; text: string }
  /** Waits for a file the test creates (smoke:checkpoints: once the turn's snapshot is taken). */
  | { do: "wait-file"; path: string; timeoutMs?: number }
  /**
   * Phase 23: sends OTLP logs the way Claude Code's exporter would, to the endpoint and with the
   * headers of its own environment (what the wrapper injected), for the session of `session-start`.
   */
  | {
      do: "otlp";
      events: Array<{ name: string; afterMs: number; attrs: Record<string, string | number> }>;
    }
  | { do: "exit"; code: number };

export interface FakeClaudeEvent {
  type: string;
  [key: string]: unknown;
}

export interface FakeClaude {
  dir: string;
  /** What the fake did, in order: start (args, FLIGHTDECK_* env), hooks, channel messages. */
  events(): FakeClaudeEvent[];
  /** What `claude agents --json` prints next (phase 27). */
  setAgents(agents: unknown[]): void;
  /** Makes `claude stop`, `respawn`... fail (or work again). */
  failCli(on: boolean): void;
  restore(): void;
}

const MAIN = join(import.meta.dir, "fake-claude-main.ts");

export function installFakeClaude(
  steps: FakeClaudeStep[],
  env: Record<string, string | undefined> = process.env,
): FakeClaude {
  const dir = realTempDir("fd-fake-claude-");
  const bun = process.execPath;
  writeFileSync(join(dir, "script.json"), JSON.stringify(steps));
  writeFileSync(join(dir, "claude"), `#!/bin/sh\nexec "${bun}" "${MAIN}" "${dir}" "$@"\n`);
  chmodSync(join(dir, "claude"), 0o755);
  writeFileSync(
    join(dir, "claude.cmd"),
    `@echo off\r\n"${bun}" "${MAIN}" "${dir}" %*\r\nexit /b %ERRORLEVEL%\r\n`,
  );
  const keys = Object.keys(env).filter((k) => k.toUpperCase() === "PATH");
  const saved = new Map(keys.map((k) => [k, env[k]]));
  for (const key of keys.length > 0 ? keys : ["PATH"]) {
    env[key] = [dir, env[key] ?? ""].filter(Boolean).join(delimiter);
  }
  return {
    dir,
    setAgents: (agents) => writeFileSync(join(dir, "agents.json"), JSON.stringify(agents)),
    failCli: (on) => {
      if (on) writeFileSync(join(dir, "fail"), "");
      else rmSync(join(dir, "fail"), { force: true });
    },
    events: () => {
      const file = join(dir, "events.jsonl");
      if (!existsSync(file)) return [];
      return readFileSync(file, "utf8")
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line) as FakeClaudeEvent);
    },
    restore: () => {
      for (const [key, value] of saved) env[key] = value;
    },
  };
}
