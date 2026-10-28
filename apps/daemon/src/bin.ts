#!/usr/bin/env bun
// Process entry point; all logic lives in main.ts, which is covered by tests.
import { runCli } from "./main.ts";

await runCli(process.argv.slice(2), {
  env: process.env,
  log: { log: (m) => console.log(m), error: (m) => console.error(m) },
  exit: (code) => process.exit(code),
  onSignal: (signal, handler) => process.on(signal, () => void handler()),
});
