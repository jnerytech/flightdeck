#!/usr/bin/env bun
// Process entry point; all logic lives in cli/run.ts and main.ts, which are covered by tests.
import { runCommandCli } from "./cli/run.ts";

const argv = process.argv.slice(2);
const deps = {
  env: process.env,
  log: { log: (m: string) => console.log(m), error: (m: string) => console.error(m) },
  exit: (code: number) => process.exit(code),
  onSignal: (signal: "SIGINT" | "SIGTERM", handler: () => Promise<void>) =>
    process.on(signal, () => void handler()),
};

// A command that is not the daemon runs here, before main.ts (the whole daemon) is imported (#1692).
if (!(await runCommandCli(argv, deps))) await (await import("./main.ts")).runCli(argv, deps);
