#!/usr/bin/env bun
/** `bun run release:version <tag>`: fails unless the tag is v<version> of every package. */
import { resolve } from "node:path";
import { readProductVersions, tagProblems } from "./lib/release.ts";

const ROOT = resolve(import.meta.dir, "..");
const tag = process.argv.slice(2).find((a) => a !== "--") ?? "";
const problems = tagProblems(tag, readProductVersions(ROOT));
if (problems.length > 0) {
  for (const problem of problems) console.error(`release: ${problem}`);
  process.exit(1);
}
console.log(`release: a tag ${tag} confere com a versão do produto`);
