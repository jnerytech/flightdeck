#!/usr/bin/env bun
/**
 * `bun run lint:sonar [--all] [--base <ref>] [--no-types] [--files <path>...]`: Sonar's own
 * JS/TS rules (eslint-plugin-sonarjs) on the lines changed since the merge-base with main (the
 * "new code" SonarCloud's gate judges), or on every tracked file with `--all`. Biome stays the linter; this only mirrors SonarCloud's profile.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as parser from "@typescript-eslint/parser";
import { ESLint, type Linter } from "eslint";
import sonarjs from "eslint-plugin-sonarjs";
import {
  addedLines,
  applySuppressions,
  exclusionsOf,
  type Finding,
  formatFindings,
  lintTargets,
  onlyNewCode,
  sonarRules,
} from "../../scripts/lib/sonar-lint.ts";

const ROOT = resolve(import.meta.dir, "../..");
const args = process.argv.slice(2).filter((a) => a !== "--");
const git = (gitArgs: string[]) => {
  const proc = spawnSync("git", gitArgs, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
  return proc.status === 0 ? proc.stdout.split("\n").filter(Boolean) : null;
};
const after = (flag: string) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
};

let paths: string[];
let added = new Map<string, Set<number>>();
const filesAt = args.indexOf("--files");
if (filesAt >= 0) paths = args.slice(filesAt + 1);
else if (args.includes("--all")) paths = git(["ls-files"]) ?? [];
else {
  const base = after("--base") ?? git(["merge-base", "HEAD", "main"])?.[0];
  if (!base) {
    console.error("lint:sonar: no base to compare with");
    process.exit(2);
  }
  // Committed, staged and edited files, plus new ones git does not track yet.
  const changed = git(["diff", "--name-only", "--diff-filter=ACMR", base]) ?? [];
  const untracked = git(["ls-files", "--others", "--exclude-standard"]) ?? [];
  paths = [...new Set([...changed, ...untracked])];
  added = addedLines((git(["diff", "-U0", "--diff-filter=ACMR", base]) ?? []).join("\n"));
}
const exclusions = exclusionsOf(readFileSync(resolve(ROOT, "sonar-project.properties"), "utf8"));
const targets = filesAt >= 0 ? paths : lintTargets(paths, exclusions);
if (targets.length === 0) {
  console.log("lint:sonar: no source file to check");
  process.exit(0);
}

const profile = JSON.parse(readFileSync(resolve(ROOT, "scripts/sonar-profile.json"), "utf8"));
const set = sonarRules(
  Object.entries(sonarjs.rules).map(([name, rule]) => ({
    name,
    url: rule.meta?.docs?.url ?? "",
    typed: Boolean(rule.meta?.docs?.requiresTypeChecking),
  })),
  profile.rules,
);
const withTypes = !args.includes("--no-types");
const rules: Linter.RulesRecord = {};
for (const id of withTypes ? [...set.untyped, ...set.typed] : set.untyped) rules[id] = "error";

const eslint = new ESLint({
  cwd: ROOT,
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs", "**/*.cjs"],
      languageOptions: {
        parser,
        parserOptions: withTypes ? { projectService: true, tsconfigRootDir: ROOT } : {},
      },
      plugins: { sonarjs },
      rules,
    },
  ],
});
const results = await eslint.lintFiles(targets);
const findings: Finding[] = results.flatMap((result) =>
  result.messages.map((m) => ({
    file: resolve(result.filePath).slice(ROOT.length + 1),
    line: m.line,
    rule: m.ruleId ?? "parse-error",
    message: m.message,
  })),
);
const cache = new Map<string, string[]>();
const linesOf = (file: string) => {
  if (!cache.has(file)) cache.set(file, readFileSync(resolve(ROOT, file), "utf8").split("\n"));
  return cache.get(file) as string[];
};
const left = onlyNewCode(applySuppressions(findings, linesOf), added);
console.log(`lint:sonar: ${targets.length} file(s), ${Object.keys(rules).length} rule(s)`);
console.log(formatFindings(left));
process.exit(left.length > 0 ? 1 : 0);
