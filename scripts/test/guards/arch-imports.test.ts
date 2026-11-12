import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cruise } from "dependency-cruiser";
import { grownRules, KNOWN, newRules, ruleCounts, runArchRatchet } from "../../lib/arch-ratchet.ts";
import { type CruiseModule, cycleFiles } from "../../lib/cycle-files.ts";
import { realTempDir } from "../temp-dir.ts";

// The real rules: a planted import is judged by what CI runs (`bun run arch`).
const CONFIG = require("../../../.dependency-cruiser.cjs") as {
  forbidden: unknown[];
  options: Record<string, unknown>;
};
// The planted tree has no tsconfig, so its imports are relative (the real run resolves `@/` too).
const { tsConfig: _tsConfig, ...PLANTED_OPTIONS } = CONFIG.options;

/** The violations the real rules find in a planted tree, as `<rule> <from> -> <to>`. */
async function planted(files: Record<string, string>): Promise<string[]> {
  const root = realTempDir("fd-arch-");
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const roots = ["apps/daemon/src", "apps/desktop/src", "packages/protocol/src"].filter((dir) =>
      Object.keys(files).some((path) => path.startsWith(dir)),
    );
    const result = await cruise(roots, {
      ...PLANTED_OPTIONS,
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

/** The files in a cycle of a planted desktop tree, counted the way `bun run arch` counts them. */
async function plantedCycleFiles(files: Record<string, string>): Promise<string[]> {
  const root = realTempDir("fd-arch-");
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const result = await cruise(["apps/desktop/src"], {
      ...PLANTED_OPTIONS,
      baseDir: root,
    } as Parameters<typeof cruise>[1]);
    return cycleFiles((result.output as { modules: CruiseModule[] }).modules);
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

  test("shared/ may import the domain-free leaves and itself, never a domain (#1597)", async () => {
    const found = await planted({
      "apps/desktop/src/shared/box.ts":
        'import { cn } from "../lib/utils.ts";\nimport { Button } from "../components/ui/button.tsx";\nimport { util } from "./util.ts";\nimport { store } from "../lib/app-store.ts";\nexport const b = [cn, Button, util, store];\n',
      "apps/desktop/src/shared/util.ts": "export const util = 1;\n",
      "apps/desktop/src/lib/utils.ts": "export const cn = 1;\n",
      "apps/desktop/src/components/ui/button.tsx": "export const Button = 1;\n",
      "apps/desktop/src/lib/app-store.ts": "export const store = 1;\n",
    });
    expect(found).toEqual([
      "shared-depends-on-no-domain apps/desktop/src/shared/box.ts -> apps/desktop/src/lib/app-store.ts",
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

  test("a deep import into another desktop feature fails; its entry and the feature's own files pass (#1624)", async () => {
    const found = await planted({
      "apps/desktop/src/features/board/board.tsx":
        'import { start } from "../sessions/store.ts";\nimport { list } from "../sessions/index.ts";\nimport { col } from "./columns.ts";\nexport const b = [start, list, col];\n',
      "apps/desktop/src/features/board/columns.ts": "export const col = 1;\n",
      "apps/desktop/src/features/sessions/store.ts": "export const start = 1;\n",
      "apps/desktop/src/features/sessions/index.ts": "export const list = 2;\n",
    });
    expect(found).toEqual([
      "desktop-no-deep-cross-domain apps/desktop/src/features/board/board.tsx -> apps/desktop/src/features/sessions/store.ts",
    ]);
  });

  test("a feature that imports lib/ or its own subfolders is no cross-feature import (#1624)", async () => {
    const found = await planted({
      "apps/desktop/src/features/board/board.tsx":
        'import { x } from "../../lib/x.ts";\nimport { y } from "./parts/y.ts";\nexport const b = [x, y];\n',
      "apps/desktop/src/lib/x.ts": "export const x = 1;\n",
      "apps/desktop/src/features/board/parts/y.ts": "export const y = 2;\n",
    });
    expect(found).toEqual([]);
  });

  test("a cycle in the desktop is no violation of the borders: its files are counted instead (#1624)", async () => {
    const files = {
      "apps/desktop/src/features/board/a.ts": 'import { b } from "./b.ts";\nexport const a = b;\n',
      "apps/desktop/src/features/board/b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n',
    };
    expect(await planted(files)).toEqual([]);
    expect(await plantedCycleFiles(files)).toEqual([
      "apps/desktop/src/features/board/a.ts",
      "apps/desktop/src/features/board/b.ts",
    ]);
  });

  test("the files in a cycle do not change when a file moves or a barrel carries the import (#1624)", async () => {
    const A = "apps/desktop/src/features/board/a.ts";
    const direct = await plantedCycleFiles({
      [A]: 'import { b } from "../sessions/b.ts";\nexport const a = b;\n',
      "apps/desktop/src/features/sessions/b.ts":
        'import { a } from "../board/a.ts";\nexport const b = a;\n',
    });
    // b moves to another folder and reaches a through the feature's index.ts, as CLAUDE.md requires
    const moved = await plantedCycleFiles({
      [A]: 'import { b } from "../setup/b.ts";\nexport const a = b;\n',
      "apps/desktop/src/features/board/index.ts": 'export { a } from "./a.ts";\n',
      "apps/desktop/src/features/setup/b.ts":
        'import { a } from "../board/index.ts";\nexport const b = a;\n',
    });
    expect(direct).toHaveLength(2);
    expect(moved).toHaveLength(2);
    expect(moved).not.toContain("apps/desktop/src/features/board/index.ts");
  });

  test("a chain, an import of one's own barrel and a self import sit in no cycle (#1624)", async () => {
    expect(
      await plantedCycleFiles({
        "apps/desktop/src/features/board/a.ts":
          'import { b } from "./b.ts";\nexport const a = b;\n',
        "apps/desktop/src/features/board/b.ts":
          'import { i } from "./index.ts";\nimport { s } from "./b.ts";\nexport const b = [i, s];\n',
        "apps/desktop/src/features/board/index.ts": 'export { a } from "./a.ts";\n',
      }),
    ).toEqual([]);
  });

  test("an index.ts with code of its own is a file like any other, so a cycle through it counts it (#1624)", async () => {
    expect(
      await plantedCycleFiles({
        "apps/desktop/src/features/board/index.ts":
          'import { b } from "../sessions/b.ts";\nexport const a = b;\n',
        "apps/desktop/src/features/sessions/b.ts":
          'import { a } from "../board/index.ts";\nexport const b = a;\n',
      }),
    ).toEqual([
      "apps/desktop/src/features/board/index.ts",
      "apps/desktop/src/features/sessions/b.ts",
    ]);
  });

  test("a rule new in this PR may bring its first baseline; a rule main already has may not grow (#1624)", () => {
    const config = '{ name: "no-cycle" }, { name: "shared-depends-on-no-domain" }';
    const git = (args: string[]) =>
      ({
        "merge-base HEAD origin/main": "base1\n",
        [`show base1:${KNOWN}`]: known(["no-cycle"]),
        "show base1:.dependency-cruiser.cjs": config,
      })[args.join(" ")] ?? null;
    // The head's baseline and its config; a config that keeps every rule of main and adds one.
    const head = (
      violations: string[],
      headConfig: string | null = `${config}, { name: "desktop-no-cycle" }`,
    ) => ({
      git,
      readFile: (path: string) => (path === KNOWN ? known(violations) : headConfig),
    });
    const first = runArchRatchet(head(["no-cycle", "desktop-no-cycle", "desktop-no-cycle"]));
    expect(first.code).toBe(0);
    expect(first.output).toContain("desktop-no-cycle 2");
    const grew = runArchRatchet(head(["no-cycle", "no-cycle", "desktop-no-cycle"]));
    expect(grew.code).toBe(1);
    expect(grew.output).toContain("no-cycle: 1 -> 2");
    expect(grew.output).not.toContain("desktop-no-cycle:");
    const empty = runArchRatchet(head(["no-cycle", "shared-depends-on-no-domain"]));
    expect(empty.code).toBe(1);
    expect(empty.output).toContain("shared-depends-on-no-domain: 0 -> 1");
  });

  test("a renamed rule does not launder its violations: nothing is exempt when a rule of main is gone (#1624)", () => {
    const git = (args: string[]) =>
      ({
        "merge-base HEAD origin/main": "base1\n",
        [`show base1:${KNOWN}`]: known(["no-cycle", "no-cycle"]),
        "show base1:.dependency-cruiser.cjs": '{ name: "no-cycle" }',
      })[args.join(" ")] ?? null;
    const renamed = runArchRatchet({
      git,
      readFile: (path) =>
        path === KNOWN ? known(["no-cycle-2", "no-cycle-2"]) : '{ name: "no-cycle-2" }',
    });
    expect(renamed.code).toBe(1);
    expect(renamed.output).toContain("no-cycle-2: 0 -> 2");
  });

  test("a config the names cannot be read from exempts nothing, in main and at the head (#1624)", () => {
    const git = (config: string) => (args: string[]) =>
      ({
        "merge-base HEAD origin/main": "base1\n",
        [`show base1:${KNOWN}`]: known(["no-cycle"]),
        "show base1:.dependency-cruiser.cjs": config,
      })[args.join(" ")] ?? null;
    const grown = known(["no-cycle", "no-cycle", "desktop-no-cycle"]);
    // main's config in single quotes: no name is found, so no rule counts as new
    const unreadableMain = runArchRatchet({
      git: git("{ name: 'no-cycle' }"),
      readFile: (path) => (path === KNOWN ? grown : '{ name: "no-cycle" }'),
    });
    expect(unreadableMain.code).toBe(1);
    // the head's config unreadable: the same
    const unreadableHead = runArchRatchet({
      git: git('{ name: "no-cycle" }'),
      readFile: (path) => (path === KNOWN ? grown : null),
    });
    expect(unreadableHead.code).toBe(1);
  });

  test("the rules new in a config: only those the head adds, when it keeps every rule of main (#1624)", () => {
    const main = '{ name: "a" }, { name: "b" }';
    expect(newRules(main, `${main}, { name: "c" }`)).toEqual(new Set(["c"]));
    expect(newRules(main, main)).toEqual(new Set());
    // a rule of main is gone (a rename): nothing is new
    expect(newRules(main, '{ name: "a" }, { name: "c" }')).toEqual(new Set());
    // a config no name can be read from, or none at all: nothing is new
    expect(newRules("{ name: 'a' }", '{ name: "a" }, { name: "c" }')).toEqual(new Set());
    expect(newRules(main, null)).toEqual(new Set());
    expect(newRules(null, main)).toEqual(new Set());
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
    const first = runArchRatchet({
      git: (args) => (args[0] === "merge-base" ? "base1\n" : null),
      readFile: () => known(["no-cycle", "no-cycle"]),
    });
    expect(first).toEqual({
      code: 0,
      output: `arch-ratchet: no ${KNOWN} on main yet; this one is the first baseline (no-cycle 2)`,
    });
    const same = runArchRatchet({ git, readFile: () => known(["no-cycle"]) });
    expect(same).toEqual({
      code: 0,
      output: "arch-ratchet: no rule's known violations grew (no-cycle 1)",
    });
  });
});
