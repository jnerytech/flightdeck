#!/usr/bin/env bun
/**
 * `bun run sonar-left [-- --severity CRITICAL,MAJOR] [--path <prefix>]` (issue #1477): SonarCloud's
 * open findings on main, `STALE?` where the file changed on main since Sonar's last analysed
 * commit. The logic is in lib/sonar-left.ts. The API is public: no token is read.
 *
 * `-- --local [--path <prefix>]` (issue #1528): the functions over Sonar's complexity limit (S3776),
 * found by running Sonar's own rule (eslint-plugin-sonarjs) over the tracked sources, with no
 * analysis to wait for. It reads the sources and writes nothing. It is for S3776 only: Biome stays
 * the linter. The logic is in lib/sonar-local.ts.
 */
import Module, { createRequire } from "node:module";
import { relative } from "node:path";
import { runCommand } from "../apps/daemon/src/board/command.ts";
import { sonarLeft } from "./lib/sonar-left.ts";
import { COMPLEXITY_LIMIT, type LintFinding, sonarLocal } from "./lib/sonar-local.ts";

const git = async (args: string[]) => {
  const ran = await runCommand(["git", ...args], process.cwd(), undefined, 30_000);
  return { code: ran.timedOut ? 124 : ran.code, stdout: ran.stdout };
};
/**
 * Runs eslint-plugin-sonarjs' cognitive-complexity rule over `files`. typescript-eslint needs the
 * TypeScript 6 API and the repository compiles with TypeScript 7, so `typescript` is resolved to
 * the copy eslint-plugin-sonarjs brings (it depends on `typescript` >=5 <6.1). Nothing is cached or
 * written: ESLint gets its config here, not from a file.
 */
async function lintComplexity(files: string[]): Promise<LintFinding[]> {
  const here = createRequire(import.meta.url);
  const ts6 = createRequire(here.resolve("eslint-plugin-sonarjs/package.json")).resolve(
    "typescript",
  );
  const hooked = Module as unknown as {
    _resolveFilename(request: string, ...rest: unknown[]): string;
  };
  const resolve = hooked._resolveFilename;
  hooked._resolveFilename = function (request: string, ...rest: unknown[]) {
    return request === "typescript" ? ts6 : resolve.call(this, request, ...rest);
  };
  const { ESLint } = await import("eslint");
  const sonarjs = (await import("eslint-plugin-sonarjs")).default;
  const tseslint = (await import("typescript-eslint")).default;
  const eslint = new ESLint({
    cwd: process.cwd(),
    overrideConfigFile: true,
    ignore: false,
    cache: false,
    overrideConfig: [
      {
        files: ["**/*.ts", "**/*.tsx"],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: { sonarjs },
        rules: { "sonarjs/cognitive-complexity": ["error", COMPLEXITY_LIMIT] },
      },
    ],
  });
  const found: LintFinding[] = [];
  for (const result of await eslint.lintFiles(files)) {
    const file = relative(process.cwd(), result.filePath);
    for (const m of result.messages) {
      if (m.fatal) throw new Error(`${file}:${m.line} ${m.message}`);
      found.push({ file, line: m.line, message: m.message });
    }
  }
  return found;
}

const log = (line: string) => console.log(line); // NOSONAR: lib/sonar-left.ts and lib/sonar-local.ts pass API, git and linter text through oneLine (no control or bidi characters)
process.exit(
  process.argv.includes("--local")
    ? await sonarLocal(process.argv.slice(2), { git, lint: lintComplexity, log })
    : await sonarLeft(process.argv.slice(2), {
        fetch: (url) => fetch(url, { signal: AbortSignal.timeout(30_000) }),
        git,
        log,
      }),
);
