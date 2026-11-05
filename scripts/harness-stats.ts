#!/usr/bin/env bun
/**
 * `bun run harness:stats`: how often each rule of the project's Claude Code hooks blocks and how
 * long the hooks take, from the log they append to (scripts/lib/hook-log.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hookLogPath, summarizeHookLog } from "./lib/hook-log.ts";

const path = hookLogPath(resolve(import.meta.dir, ".."));
const files = path ? [`${path}.1`, path].filter((p) => existsSync(p)) : [];
console.log(summarizeHookLog(files.map((p) => readFileSync(p, "utf8")).join("\n")));
if (path) console.log(`\nlog: ${path}`);
