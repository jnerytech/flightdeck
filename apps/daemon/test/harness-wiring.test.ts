import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SecretScanner } from "@flightdeck/protocol";
import { createHarness } from "../src/harness/wiring.ts";
import type { CompleteOptions } from "../src/runtime/types.ts";
import { tempDir } from "./helpers.ts";

/**
 * The harness the server offers (#75), as main.ts builds it (#1593): the drafts run on the host's
 * runtime in the assistant's folder, an apply sees the held drafts, and the templates live in the
 * data folder.
 */
const DRAFTED = "# Shop\n\n## Commands\n\n- Test: `bun run test`\n";

function project(files: Record<string, string> = {}) {
  const root = tempDir("fd-harness-wiring-");
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { test: "bun test" } }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return root;
}

/** The harness over a runtime that drafts DRAFTED (or over one that cannot run a one-shot). */
function harness(options: { oneShot: boolean }) {
  const cwd = tempDir("fd-harness-wiring-scratch-");
  const dataDir = tempDir("fd-harness-wiring-data-");
  const ranIn: string[] = [];
  const runtime = options.oneShot
    ? {
        complete: async (opts: CompleteOptions) => {
          ranIn.push(opts.cwd);
          return { text: DRAFTED, subtype: "success" };
        },
      }
    : {};
  const built = createHarness({
    runtime,
    quota: { blocked: () => null },
    scanner: new SecretScanner(() => []),
    cwd,
    config: { dataDir, allowApiKey: false },
  });
  return { built, ranIn, cwd, dataDir };
}

async function outcome(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return "ok";
  } catch (error) {
    return (error as { reason?: string }).reason ?? String(error);
  }
}

describe("harness-wiring: the host's harness, built from its runtime and data folder (#1593)", () => {
  test("a runtime that cannot run a one-shot offers no draft", () => {
    const { built } = harness({ oneShot: false });
    expect("harnessDraft" in built).toBe(false);
  });

  test("a draft runs on the host's runtime in the assistant's folder, and an apply writes it", async () => {
    const { built, ranIn, cwd } = harness({ oneShot: true });
    const root = project();
    const draft = await built.harnessDraft?.(root);
    expect(ranIn).toEqual([cwd]);
    const preview = await built.harnessPreview(root, ["claudeMd"]);
    const digests = Object.fromEntries(preview.files.map((file) => [file.path, file.digest]));
    await built.harnessApply(
      root,
      ["claudeMd"],
      { ...digests, "CLAUDE.md": draft?.digest ?? "" },
      { reformat: false },
    );
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(DRAFTED);
  });

  test("a shared template is kept in the data folder's harness-templates", async () => {
    const { built, dataDir } = harness({ oneShot: false });
    const root = project({ "CLAUDE.md": DRAFTED });
    await built.harnessTemplates.export(root, "shop", "Shop");
    expect(existsSync(join(dataDir, "harness-templates", "shop"))).toBe(true);
  });

  test("a commit of files apply never wrote is refused as stale", async () => {
    const { built } = harness({ oneShot: false });
    expect(await outcome(built.harnessCommit(project(), {}))).toBe("harness_commit_stale");
  });
});
