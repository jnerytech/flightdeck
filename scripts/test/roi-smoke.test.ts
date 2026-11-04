import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("roi-smoke: the smoke of the return on cost is wired in", () => {
  test("package.json runs it, CI runs it, and it prints the line the checklist looks for", () => {
    const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;
    expect(scripts["smoke:roi"]).toBe("bun run scripts/smoke-roi.ts");
    expect(read(".github/workflows/ci.yml")).toContain("bun run smoke:roi");
    expect(existsSync(join(ROOT, "scripts/smoke-roi.ts"))).toBe(true);
    expect(read("scripts/smoke-roi.ts")).toContain("SMOKE ROI OK");
  });
});
