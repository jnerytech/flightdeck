import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cruise } from "dependency-cruiser";
import { grownRules, KNOWN, ruleCounts, runArchRatchet } from "../lib/arch-ratchet.ts";

// The real rules: a planted import is judged by what CI runs (`bun run arch`).
const CONFIG = require("../../.dependency-cruiser.cjs") as {
  forbidden: unknown[];
  options: Record<string, unknown>;
};

/** The violations the real rules find in a planted tree, as `<rule> <from> -> <to>`. */
async function planted(files: Record<string, string>): Promise<string[]> {
  const root = mkdtempSync(join(tmpdir(), "fd-arch-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const roots = ["apps/daemon/src", "packages/protocol/src"].filter((dir) =>
      Object.keys(files).some((path) => path.startsWith(dir)),
    );
    const result = await cruise(roots, {
      ...CONFIG.options,
      ruleSet: { forbidden: CONFIG.forbidden },
      validate: true,
      baseDir: root,
    } as Parameters<typeof cruise>[1]);
    const output = result.output as {
      summary: { violations: { rule: { name: string }; from: string; to: string }[] };
    };
    return output.summary.violations.map((v) => `${v.rule.name} ${v.from} -> ${v.to}`).sort();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const known = (rules: string[]) =>
  JSON.stringify(
    rules.map((name, i) => ({
      type: "dependency",
      from: `a${i}`,
      to: "b",
      rule: { severity: "error", name },
    })),
  );

describe("arch-imports: the domain borders (#1591)", () => {
  test("a deep import into another domain fails; its entry and the domain's own files pass", async () => {
    const found = await planted({
      "apps/daemon/src/board/board.ts":
        'import { start } from "../sessions/session-manager.ts";\nimport { list } from "../sessions/index.ts";\nimport { col } from "./columns.ts";\nexport const b = [start, list, col];\n',
      "apps/daemon/src/board/columns.ts": "export const col = 1;\n",
      "apps/daemon/src/sessions/session-manager.ts": "export const start = 1;\n",
      "apps/daemon/src/sessions/index.ts": "export const list = 2;\n",
    });
    expect(found).toEqual([
      "no-deep-cross-domain apps/daemon/src/board/board.ts -> apps/daemon/src/sessions/session-manager.ts",
    ]);
  });

  test("a new cycle between two domains fails", async () => {
    const found = await planted({
      "apps/daemon/src/board/index.ts":
        'import { s } from "../sessions/index.ts";\nexport const b = s;\n',
      "apps/daemon/src/sessions/index.ts":
        'import { b } from "../board/index.ts";\nexport const s = b;\n',
    });
    expect(found).toEqual([
      // dependency-cruiser reports a cycle once, from the first module it meets.
      "no-cycle apps/daemon/src/board/index.ts -> apps/daemon/src/sessions/index.ts",
    ]);
  });

  test("a protocol context file that imports the entry fails; the entry importing it passes", async () => {
    const found = await planted({
      "packages/protocol/src/index.ts": 'export * from "./vault.ts";\nexport const V = 1;\n',
      "packages/protocol/src/vault.ts":
        'import { V } from "./index.ts";\nexport const vault = V;\n',
    });
    expect(found).toContain(
      "protocol-context-not-from-entry packages/protocol/src/vault.ts -> packages/protocol/src/index.ts",
    );
  });

  test("the counts per rule of a known-violations file; an unreadable one counts nothing", () => {
    expect(ruleCounts(known(["no-cycle", "no-cycle", "no-deep-cross-domain"]))).toEqual({
      "no-cycle": 2,
      "no-deep-cross-domain": 1,
    });
    expect(ruleCounts(null)).toEqual({});
    expect(ruleCounts("not json")).toEqual({});
  });

  test("a rule whose count went up is named; a rule that went down or a moved entry is not", () => {
    expect(
      grownRules(
        { "no-cycle": 63, "no-deep-cross-domain": 287 },
        { "no-cycle": 64, "no-deep-cross-domain": 280 },
      ),
    ).toEqual(["no-cycle: 63 -> 64"]);
    expect(grownRules({}, { "shared-depends-on-no-domain": 1 })).toEqual([
      "shared-depends-on-no-domain: 0 -> 1",
    ]);
    expect(grownRules({ "no-cycle": 2 }, { "no-cycle": 2 })).toEqual([]);
  });

  test("over git: the baseline at the merge-base with main against the working copy", () => {
    const git = (args: string[]) =>
      ({
        "merge-base HEAD origin/main": "base1\n",
        [`show base1:${KNOWN}`]: known(["no-cycle"]),
      })[args.join(" ")] ?? null;
    const grew = runArchRatchet({ git, readFile: () => known(["no-cycle", "no-cycle"]) });
    expect(grew.code).toBe(1);
    expect(grew.output).toContain("no-cycle: 1 -> 2");
    const same = runArchRatchet({ git, readFile: () => known(["no-cycle"]) });
    expect(same).toEqual({
      code: 0,
      output: "arch-ratchet: no rule's known violations grew (no-cycle 1)",
    });
  });
});
