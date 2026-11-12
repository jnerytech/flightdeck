import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isScanned, rawJsonParseCounts } from "../../lib/ratchets/json-parse.ts";
import { overBaseline } from "../../lib/ratchets/layout.ts";

// repo-wide (#1108): reads every tracked source file, so CI's quick job runs it on every PR.

const ROOT = resolve(import.meta.dir, "../../..");

describe("json-parse (#1609)", () => {
  test("TypeScript under a package's src is scanned; tests, declarations and the JSON text helper are not", () => {
    expect(isScanned("apps/daemon/src/store/db.ts")).toBe(true);
    expect(isScanned("apps/desktop/src/lib/storage.tsx")).toBe(true);
    expect(isScanned("packages/protocol/src/index.ts")).toBe(true);
    expect(isScanned("apps/daemon/test/store/db.test.ts")).toBe(false);
    expect(isScanned("apps/daemon/src/text-modules.d.ts")).toBe(false);
    expect(isScanned("apps/daemon/src/kernel/json-text.ts")).toBe(false);
    expect(isScanned("apps/desktop/src/shared/lib/stored-json.ts")).toBe(false);
    expect(isScanned("scripts/lib/slot/index.ts")).toBe(false);
    expect(isScanned("apps/desktop/src/styles.css")).toBe(false);
  });

  test("each raw JSON.parse call outside a comment counts, per file; files with none are left out", () => {
    expect(
      rawJsonParseCounts([
        {
          path: "apps/daemon/src/a.ts",
          text: "const x = JSON.parse(a);\nconst y = JSON.parse(b);\n",
        },
        {
          path: "apps/daemon/src/b.ts",
          text: "// JSON.parse(a) is avoided here\n * JSON.parse(c)\n",
        },
        { path: "apps/daemon/src/c.ts", text: "const ok = Schema.parse(raw);\n" },
        { path: "apps/daemon/test/d.test.ts", text: "JSON.parse(x);\n" },
        { path: "apps/daemon/src/kernel/json-text.ts", text: "return JSON.parse(text);\n" },
      ]),
    ).toEqual({ "apps/daemon/src/a.ts": 2 });
  });

  test("a new file with a raw call, or a baseline file with more, fails the ratchet", () => {
    const counts = rawJsonParseCounts([
      { path: "apps/daemon/src/a.ts", text: "JSON.parse(a);\nJSON.parse(b);\n" },
      { path: "apps/daemon/src/new.ts", text: "JSON.parse(c);\n" },
    ]);
    expect(overBaseline(counts, { "apps/daemon/src/a.ts": 1 })).toEqual([
      "apps/daemon/src/a.ts: 2 > 1",
      "apps/daemon/src/new.ts: 1 > 0",
    ]);
  });

  test("no tracked source file has more raw JSON.parse calls than json-parse-baseline.json allows", () => {
    const paths = spawnSync("git", ["ls-files", "apps", "packages"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .stdout.split("\n")
      .filter(isScanned);
    expect(paths.length).toBeGreaterThan(500);
    const counts = rawJsonParseCounts(
      paths.map((path) => ({ path, text: readFileSync(join(ROOT, path), "utf8") })),
    );
    const baseline = JSON.parse(readFileSync(join(ROOT, "json-parse-baseline.json"), "utf8"));
    expect(overBaseline(counts, baseline)).toEqual([]);
  });
});
