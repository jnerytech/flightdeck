import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { impureCalls, isDomainFile } from "../../lib/ratchets/domain-purity.ts";

// repo-wide (#1108): reads every tracked source file, so CI's quick job runs it on every PR.

const ROOT = resolve(import.meta.dir, "../../..");

describe("domain-purity (#1601)", () => {
  test("TypeScript under a domain/ folder of a package's src is scanned; the rest is not", () => {
    expect(isDomainFile("apps/daemon/src/board/domain/rules.ts")).toBe(true);
    expect(isDomainFile("apps/desktop/src/features/hosts/domain/health.tsx")).toBe(true);
    expect(isDomainFile("packages/protocol/src/domain/card.ts")).toBe(true);
    expect(isDomainFile("apps/daemon/src/board/adapters/store.ts")).toBe(false);
    expect(isDomainFile("apps/daemon/src/board/board.ts")).toBe(false);
    expect(isDomainFile("apps/daemon/test/board/domain/rules.test.ts")).toBe(false);
    expect(isDomainFile("apps/daemon/src/board/domain/types.d.ts")).toBe(false);
  });

  test("a call to Bun.spawn, Bun.file, Bun.write, Date.now or new Date() in a domain/ file is named with its line", () => {
    expect(
      impureCalls([
        {
          path: "apps/daemon/src/board/domain/rules.ts",
          text: [
            "const p = Bun.spawn(['git']);",
            "const f = Bun.file(path);",
            "await Bun.write(path, text);",
            "const t = Date.now();",
            "const d = new Date();",
            "const q = Bun.spawnSync(['git']);",
          ].join("\n"),
        },
      ]),
    ).toEqual([
      "apps/daemon/src/board/domain/rules.ts:1 Bun.spawn(",
      "apps/daemon/src/board/domain/rules.ts:2 Bun.file(",
      "apps/daemon/src/board/domain/rules.ts:3 Bun.write(",
      "apps/daemon/src/board/domain/rules.ts:4 Date.now(",
      "apps/daemon/src/board/domain/rules.ts:5 new Date()",
      "apps/daemon/src/board/domain/rules.ts:6 Bun.spawnSync(",
    ]);
  });

  test("comments, a date built from a value, files outside domain/ and a clock passed in are not calls", () => {
    expect(
      impureCalls([
        {
          path: "apps/daemon/src/board/domain/rules.ts",
          text: [
            "// Date.now() comes in through the port",
            " * Bun.spawn( is the adapter's job",
            "const d = new Date(ms);",
            "export const age = (now: () => number, at: number) => now() - at;",
          ].join("\n"),
        },
        {
          path: "apps/daemon/src/board/adapters/clock.ts",
          text: "export const now = () => Date.now();\n",
        },
      ]),
    ).toEqual([]);
  });

  test("no tracked domain/ file calls an I/O or clock global", () => {
    const paths = spawnSync("git", ["ls-files", "apps", "packages"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .stdout.split("\n")
      .filter(isDomainFile);
    const files = paths.map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") }));
    expect(impureCalls(files)).toEqual([]);
  });
});
