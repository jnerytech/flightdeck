// Loaded with `--preload` by `bun run coverage:funcs` only, never by the bunfig. Registers a Bun
// plugin that swaps the listed files for their istanbul-instrumented text as they load: the files
// on disk are never touched. After each test file the counters are written to COVERAGE_FUNCS_OUT.

import { afterAll } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { plugin } from "bun";
import { COVERAGE_VAR, createInstrumenter, onLoadFor } from "../lib/coverage-funcs.ts";

const files: string[] = JSON.parse(process.env.COVERAGE_FUNCS_FILES ?? "[]");
const out = process.env.COVERAGE_FUNCS_OUT ?? "";
const hooks = onLoadFor(files, createInstrumenter(), (path) => readFileSync(path, "utf8"));
plugin({
  name: "coverage-funcs",
  setup(build) {
    build.onLoad({ filter: hooks.filter }, (args) => hooks.load(args.path));
  },
});
// Bun runs every file of a run in one process, so each write holds all the counters so far.
afterAll(() => {
  writeFileSync(out, JSON.stringify((globalThis as Record<string, unknown>)[COVERAGE_VAR] ?? {}));
});
