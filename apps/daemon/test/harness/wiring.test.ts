import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SecretScanner } from "@flightdeck/protocol";
import { createHarness } from "../../src/harness/wiring.ts";
import type { CompleteOptions } from "../../src/runtime/types.ts";
import { tempDir } from "../support/helpers.ts";

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

/** A value the host's vault holds: the host's scanner knows it, a fresh scanner does not. */
const VAULT = "vault-value-harness-0123";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** The harness over a runtime that drafts `text` (or over one that cannot run a one-shot). */
function harness(options: { oneShot: boolean; allowApiKey?: boolean; text?: string }) {
  const cwd = tempDir("fd-harness-wiring-scratch-");
  const dataDir = tempDir("fd-harness-wiring-data-");
  const asked: Array<{ cwd: string; allowApiKey: boolean }> = [];
  const runtime = options.oneShot
    ? {
        complete: async (opts: CompleteOptions) => {
          asked.push({ cwd: opts.cwd, allowApiKey: opts.allowApiKey === true });
          return { text: options.text ?? DRAFTED, subtype: "success" };
        },
      }
    : {};
  const built = createHarness({
    runtime,
    quota: { blocked: () => null },
    scanner: new SecretScanner(() => [VAULT]),
    cwd,
    config: { dataDir, allowApiKey: options.allowApiKey ?? false },
  });
  return { built, asked, cwd, dataDir };
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
    expect("draft" in built).toBe(false);
  });

  test("a draft runs on the host's runtime in the assistant's folder, and an apply writes it", async () => {
    const { built, asked, cwd } = harness({ oneShot: true });
    expect("draft" in built).toBe(true);
    const root = project();
    const draft = await built.draft?.(root);
    expect(asked).toEqual([{ cwd, allowApiKey: false }]);
    const preview = await built.preview(root, ["claudeMd"]);
    const digests = Object.fromEntries(preview.files.map((file) => [file.path, file.digest]));
    await built.apply(
      root,
      ["claudeMd"],
      { ...digests, "CLAUDE.md": draft?.digest ?? "" },
      { reformat: false },
    );
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(DRAFTED);
  });

  test("a host that allows its API key lets the draft's one-shot use it", async () => {
    const { built, asked, cwd } = harness({ oneShot: true, allowApiKey: true });
    await built.draft?.(project());
    expect(asked).toEqual([{ cwd, allowApiKey: true }]);
  });

  test("the host's scanner judges the draft: one holding a vault value is not kept", async () => {
    const { built } = harness({ oneShot: true, text: `# Shop\n\nkey ${VAULT}\n` });
    expect(await outcome(built.draft?.(project()) ?? Promise.resolve())).toBe(
      "harness_draft_secret",
    );
  });

  test("a shared template is kept in the data folder's harness-templates", async () => {
    const { built, dataDir } = harness({ oneShot: false });
    const root = project({ "CLAUDE.md": DRAFTED });
    await built.templates.export(root, "shop", "Shop");
    expect(existsSync(join(dataDir, "harness-templates", "shop"))).toBe(true);
  });

  test("the host's scanner judges a template: a title holding a vault value is not shared", async () => {
    const { built, dataDir } = harness({ oneShot: false });
    const root = project({ "CLAUDE.md": DRAFTED });
    expect(await outcome(built.templates.export(root, "shop", `Shop ${VAULT}`))).toBe(
      "harness_template_title_secret",
    );
    expect(existsSync(join(dataDir, "harness-templates", "shop"))).toBe(false);
  });

  test("a commit reads the project's files by their digests and the host's scanner judges them", async () => {
    const { built } = harness({ oneShot: false });
    const text = `# Shop\n\nkey ${VAULT}\n`;
    const root = project({ "CLAUDE.md": text });
    expect(await outcome(built.commit(root, { "CLAUDE.md": sha(text) }))).toBe(
      "harness_commit_secret",
    );
    expect(await outcome(built.commit(root, { "CLAUDE.md": sha(DRAFTED) }))).toBe(
      "harness_commit_stale",
    );
  });
});
