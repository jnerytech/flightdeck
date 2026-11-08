import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SecretScanner } from "@flightdeck/protocol";
import { applyHarness } from "../src/harness/apply.ts";
import { type DraftDeps, HarnessDrafts } from "../src/harness/draft.ts";
import { previewHarness } from "../src/harness/preview.ts";
import { tempDir } from "./helpers.ts";

/**
 * Issue #75, slice G1a: the host drafts a CLAUDE.md with its model from the detected stack and the
 * project's top-level names, never a file's content, holds the draft, and an apply that names the
 * draft's digest writes it.
 */
const DRAFTED = "# Shop\n\n## Commands\n\n- Test: `bun run test`\n";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function project(files: Record<string, string> = {}) {
  const root = tempDir("fd-harness-draft-");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ scripts: { test: "bun test", format: "biome format ." } }),
  );
  writeFileSync(join(root, "bun.lock"), "");
  writeFileSync(join(root, "README.md"), "SECRET-CONTENT of the readme\n");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return root;
}

/** Drafts over a fake model that answers `text` and records what it was asked. */
function drafts(
  options: { text?: string; blocked?: boolean; vault?: string[]; clock?: number[] } = {},
) {
  const asked: Array<{ system: string; prompt: string }> = [];
  const deps: DraftDeps = {
    complete: async (opts) => {
      asked.push({ system: opts.system, prompt: opts.prompt });
      return { text: options.text ?? DRAFTED, subtype: "success" };
    },
    quota: { blocked: () => (options.blocked ? { until: null } : null) } as never,
    scanner: new SecretScanner(() => options.vault ?? []),
    cwd: tempDir("fd-harness-draft-scratch-"),
    allowApiKey: false,
    now: () => options.clock?.[0] ?? 0,
  };
  return { held: new HarnessDrafts(deps), asked };
}

async function outcome(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return "ok";
  } catch (error) {
    return (error as { reason?: string }).reason ?? String(error);
  }
}

/** Applies CLAUDE.md as the app does after a draft: the preview's digests, the draft's for it. */
async function applyDraft(root: string, held: HarnessDrafts, digest: string) {
  const preview = await previewHarness(root, ["claudeMd"]);
  const digests = Object.fromEntries(preview.files.map((file) => [file.path, file.digest]));
  return applyHarness(root, ["claudeMd"], { ...digests, "CLAUDE.md": digest }, { drafts: held });
}

describe("harness-draft: a CLAUDE.md drafted by the host's model, held, and applied by its digest (#75)", () => {
  test("the model gets the stack's commands and the top-level names, never a file's content", async () => {
    const { held, asked } = drafts();
    const root = project();
    const draft = await held.draft(root);
    const prompt = asked[0]?.prompt ?? "";
    expect([
      draft,
      prompt.includes("bun run test"),
      prompt.includes("package.json"),
      prompt.includes("README.md"),
      prompt.includes("SECRET-CONTENT"),
    ]).toEqual([
      { path: "CLAUDE.md", content: DRAFTED, digest: sha(DRAFTED) },
      true,
      true,
      true,
      false,
    ]);
  });

  test("an apply that names the draft's digest writes the draft; another digest is stale", async () => {
    const { held } = drafts();
    const root = project();
    const draft = await held.draft(root);
    const unknown = await outcome(applyDraft(project(), held, draft.digest));
    const written = await outcome(applyDraft(root, held, draft.digest));
    expect([
      unknown,
      written,
      existsSync(join(root, "CLAUDE.md")) && readFileSync(join(root, "CLAUDE.md"), "utf8"),
    ]).toEqual(["harness_stale", "ok", DRAFTED]);
  });

  test("a held draft expires: an apply after it is stale", async () => {
    const clock = [0];
    const { held } = drafts({ clock });
    const root = project();
    const draft = await held.draft(root);
    clock[0] = 31 * 60 * 1000;
    expect(await outcome(applyDraft(root, held, draft.digest))).toBe("harness_stale");
  });

  test("a project that has a CLAUDE.md, a quota that is out, a secret or no Markdown are refused", async () => {
    const results = [
      await outcome(drafts().held.draft(project({ "CLAUDE.md": "# Mine\n" }))),
      await outcome(drafts({ blocked: true }).held.draft(project())),
      await outcome(drafts({ vault: ["bun run test"] }).held.draft(project())),
      await outcome(drafts({ text: "Sorry, I cannot help." }).held.draft(project())),
    ];
    expect(results).toEqual([
      "harness_draft_exists",
      "assistant_quota_blocked",
      "harness_draft_secret",
      "harness_draft_failed",
    ]);
  });
});
