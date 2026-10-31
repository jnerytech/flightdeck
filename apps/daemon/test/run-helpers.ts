import type { RunConfig } from "../src/runenv/config.ts";
import type { RunHost } from "../src/runenv/manager.ts";

export interface SpawnedRun {
  terminalId: string;
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  killed: boolean;
}

/**
 * A process host that opens nothing: each spawn is recorded and stays alive until `finish` (or
 * the manager's `kill`, which ends it with 143 like a SIGTERM).
 */
export function fakeRunHost() {
  const spawned: SpawnedRun[] = [];
  const ends = new Map<string, (code: number) => void>();
  const host: RunHost = {
    spawn: (request) => {
      const terminalId = `term-${spawned.length + 1}`;
      const run: SpawnedRun = { terminalId, ...request, killed: false };
      spawned.push(run);
      const exited = new Promise<number>((resolve) => ends.set(terminalId, resolve));
      return { terminalId, exited };
    },
    kill: (terminalId) => {
      const run = spawned.find((s) => s.terminalId === terminalId);
      if (run) run.killed = true;
      ends.get(terminalId)?.(143);
    },
  };
  return {
    host,
    spawned,
    finish: (terminalId: string, code: number) => ends.get(terminalId)?.(code),
    /** The spawns whose argv starts with `program`. */
    of: (program: string) => spawned.filter((s) => s.argv[0] === program),
  };
}

/** A run.yaml already parsed, for the manager's tests. */
export function runConfig(over: Partial<RunConfig> = {}): RunConfig {
  return {
    exclusive: false,
    setup: ["prepare"],
    run: [
      {
        name: "web",
        cmd: ["serve", "--port", "{{port.web}}"],
        env: {},
        ready: null,
      },
      { name: "api", cmd: ["api"], env: { PORT: "{{port.api}}" }, ready: null },
    ],
    ports: ["web", "api"],
    ...over,
  };
}
