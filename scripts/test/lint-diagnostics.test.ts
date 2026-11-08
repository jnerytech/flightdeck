import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { realTempDir } from "./temp-dir.ts";

const ROOT = resolve(import.meta.dir, "../..");
const BIOME = join(ROOT, "node_modules", ".bin", "biome");
const INFOS = 25;

/** The arguments `bun run lint` gives Biome: what follows `biome check` in the package script. */
function lintArgs(): string[] {
  const { scripts } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const [, rest] = scripts.lint?.split("biome check") ?? [];
  return (rest ?? "").trim().split(/\s+/).filter(Boolean);
}

describe("lint: every diagnostic is printed, so an error is never hidden behind a cap (#1304)", () => {
  // Biome's own binary from node_modules/.bin is a shim on Windows; Windows runs no PR checks (#534).
  test.skipIf(process.platform === "win32")(
    "an error among more infos than Biome's default cap of 20 is printed, and nothing is left out",
    async () => {
      const dir = realTempDir("lint-diagnostics-");
      try {
        // Written the way Biome formats it, so the config itself is not a diagnostic.
        writeFileSync(
          join(dir, "biome.json"),
          [
            "{",
            '  "files": { "includes": ["src/**"] },',
            '  "formatter": { "indentStyle": "space", "lineWidth": 100 },',
            '  "linter": { "rules": { "preset": "recommended" } },',
            '  "javascript": { "formatter": { "quoteStyle": "double" } }',
            "}",
            "",
          ].join("\n"),
        );
        mkdirSync(join(dir, "src"));
        for (let i = 1; i <= INFOS; i++) {
          // lint/style/useTemplate: an info.
          writeFileSync(join(dir, "src", `a${i}.ts`), `export const a${i} = "x" + String(${i});\n`);
        }
        // A format diff: the error that was hidden on #1298.
        writeFileSync(join(dir, "src", "z.ts"), "export const z = {a:1}\n");
        const run = Bun.spawn([BIOME, "check", ...lintArgs()], {
          cwd: dir,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [out, err] = await Promise.all([
          new Response(run.stdout).text(),
          new Response(run.stderr).text(),
        ]);
        await run.exited;
        const log = out + err;
        expect(log).toContain("src/z.ts format");
        expect(log).toContain("Found 1 error");
        expect(log).not.toContain("Diagnostics not shown");
        expect(log.match(/lint\/style\/useTemplate/g)?.length).toBe(INFOS);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
