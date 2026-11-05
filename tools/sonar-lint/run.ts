#!/usr/bin/env bun
/**
 * `bun run lint:sonar [--all] [--base <ref>] [--no-types] [--files <path>...]`: Sonar's own
 * JS/TS rules (eslint-plugin-sonarjs) on the lines changed since the merge-base with main (the
 * "new code" SonarCloud's gate judges), or on every tracked file with `--all`.
 *
 * `--ratchet` is the per-rule open count: every tracked file, no typed rules, compared with
 * `sonar-baseline.json`. It fails when a rule has more findings than the baseline allows;
 * `--ratchet --write` lowers the baseline to today's counts (never raises it) and
 * `--ratchet --init` writes it once. Biome stays the linter; this only mirrors SonarCloud's profile.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as parser from "@typescript-eslint/parser";
import { ESLint, type Linter } from "eslint";
import sonarjs from "eslint-plugin-sonarjs";
import { initialised, overBaseline, tightened } from "../../scripts/lib/layout-ratchet.ts";
import {
  addedLines,
  applySuppressions,
  exclusionsOf,
  type Finding,
  formatFindings,
  isTestFile,
  lintTargets,
  onlyNewCode,
  ruleCounts,
  sonarRules,
  testInclusionsOf,
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

const ratchet = args.includes("--ratchet");
let paths: string[];
let added = new Map<string, Set<number>>();
const filesAt = args.indexOf("--files");
if (filesAt >= 0) paths = args.slice(filesAt + 1);
else if (args.includes("--all") || ratchet) paths = git(["ls-files"]) ?? [];
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
const properties = readFileSync(resolve(ROOT, "sonar-project.properties"), "utf8");
const exclusions = exclusionsOf(properties);
const testInclusions = testInclusionsOf(properties);
const targets = filesAt >= 0 ? paths : lintTargets(paths, exclusions);
if (targets.length === 0) {
  console.log("lint:sonar: no source file to check");
  process.exit(0);
}

const profile = JSON.parse(readFileSync(resolve(ROOT, "scripts/sonar-profile.json"), "utf8"));
const pluginRules = Object.entries(sonarjs.rules).map(([name, rule]) => ({
  name,
  url: rule.meta?.docs?.url ?? "",
  typed: Boolean(rule.meta?.docs?.requiresTypeChecking),
}));
const withTypes = !args.includes("--no-types") && !ratchet;

/** Lints some files with the rules Sonar runs on that kind of file (main or test code). */
async function lint(files: string[], keys: string[]): Promise<Finding[]> {
  if (files.length === 0) return [];
  const set = sonarRules(pluginRules, keys);
  const rules: Linter.RulesRecord = {};
  for (const id of withTypes ? [...set.untyped, ...set.typed] : set.untyped) rules[id] = "error";
  ruleCount += Object.keys(rules).length;
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
  const results = await eslint.lintFiles(files);
  return results.flatMap((result) =>
    result.messages.map((m) => ({
      file: resolve(result.filePath).slice(ROOT.length + 1),
      line: m.line,
      rule: m.ruleId ?? "parse-error",
      message: m.message,
    })),
  );
}
let ruleCount = 0;
const tests = targets.filter((path) => isTestFile(path, testInclusions));
const findings = [
  ...(await lint(
    targets.filter((path) => !tests.includes(path)),
    profile.rules,
  )),
  ...(await lint(tests, profile.testRules)),
];
const cache = new Map<string, string[]>();
const linesOf = (file: string) => {
  if (!cache.has(file)) cache.set(file, readFileSync(resolve(ROOT, file), "utf8").split("\n"));
  return cache.get(file) as string[];
};
const left = onlyNewCode(applySuppressions(findings, linesOf), added);
if (ratchet) {
  const file = resolve(ROOT, after("--baseline") ?? "sonar-baseline.json");
  const baseline: Record<string, number> = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : {};
  const counts = ruleCounts(left);
  const save = (next: Record<string, number>) =>
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  const total = (record: Record<string, number>) =>
    Object.values(record).reduce((a, n) => a + n, 0);
  if (args.includes("--init")) {
    const first = initialised(counts, baseline);
    if (first === null) {
      console.error("lint:sonar: the baseline already has entries: --init would raise it.");
      process.exit(1);
    }
    save(first);
    console.log(
      `lint:sonar baseline: ${Object.keys(first).length} rules, ${total(first)} findings`,
    );
    process.exit(0);
  }
  if (args.includes("--write")) {
    const next = tightened(counts, baseline);
    save(next);
    console.log(`lint:sonar baseline: ${Object.keys(next).length} rules, ${total(next)} findings`);
    process.exit(0);
  }
  const over = overBaseline(counts, baseline);
  console.log(
    `lint:sonar --ratchet: ${total(counts)} findings in ${Object.keys(counts).length} rules`,
  );
  for (const line of over) console.error(`  ${line}`);
  if (over.length > 0) {
    console.error(
      "lint:sonar: a rule has more findings than the baseline allows. Fix the new ones.",
    );
    process.exit(1);
  }
  process.exit(0);
}
console.log(`lint:sonar: ${targets.length} file(s) (${tests.length} test), ${ruleCount} rule(s)`);
console.log(formatFindings(left));
process.exit(left.length > 0 ? 1 : 0);
