#!/usr/bin/env bun
// Key of the weekly mutation run's incremental cache (#2485): a digest of the files of every domain
// in mutation-domains.json, the domain list itself and the Stryker settings. The logic is in
// scripts/lib/mutation/cache-key.ts; the workflow reads `key=` from this script's output.
import { appendFileSync, readFileSync } from "node:fs";
import { cacheKey, keyFiles } from "./lib/mutation/cache-key.ts";
import type { MutationDomain } from "./lib/mutation/report.ts";

const domains = JSON.parse(readFileSync("mutation-domains.json", "utf8")) as MutationDomain[];
const files = [...keyFiles(domains), "mutation-domains.json", "stryker.config.json"];
const line = `key=${cacheKey(files, (path) => readFileSync(path, "utf8"))}`;
console.log(line);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
