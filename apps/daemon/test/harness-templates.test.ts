import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SecretScanner } from "@flightdeck/protocol";
import { HarnessTemplates } from "../src/harness/templates-store.ts";
import { tempDir } from "./helpers.ts";

/**
 * Issue #75, slice T1a: a project's Markdown harness (CLAUDE.md, agents, skills) is shared as a host
 * template; settings never are, nor anything the scanner flags, nor a file reached through a link.
 */
const posix = process.platform !== "win32";

function project(files: Record<string, string>) {
  const root = tempDir("fd-harness-tpl-project-");
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

function store(vault: string[] = []) {
  const dir = join(tempDir("fd-harness-tpl-host-"), "harness-templates");
  return { dir, templates: new HarnessTemplates(dir, new SecretScanner(() => vault)) };
}

/** A stored file's text, or null when it is not there. */
const stored = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);

async function outcome(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return "ok";
  } catch (error) {
    return (error as { reason?: string }).reason ?? String(error);
  }
}

const SHOP = {
  "CLAUDE.md": "# Shop\n\nRun `bun run test`.\n",
  ".claude/agents/reviewer.md": "# Reviewer\n",
  ".claude/skills/tdd/SKILL.md": "# TDD\n",
  ".claude/settings.json": JSON.stringify({ env: { API_KEY: "k" }, hooks: { PostToolUse: [] } }),
};

describe("harness-templates: a project's Markdown harness shared as a host template (#75)", () => {
  test("CLAUDE.md, agents and skills are copied; settings never; the listing has names, no content", async () => {
    const { dir, templates } = store();
    const info = await templates.export(project(SHOP), "shop", "Shop setup");
    const listed = await templates.list();
    expect([
      info,
      stored(join(dir, "shop", "CLAUDE.md")),
      stored(join(dir, "shop", "agents", "reviewer.md")),
      stored(join(dir, "shop", "skills", "tdd", "SKILL.md")),
      existsSync(join(dir, "shop", "settings.json")),
      JSON.stringify(listed).includes("bun run test"),
      listed.map((t) => t.id),
    ]).toEqual([
      {
        id: "shop",
        title: "Shop setup",
        files: ["CLAUDE.md", "agents/reviewer.md", "skills/tdd/SKILL.md"],
        bytes: 22 + 11 + 6,
      },
      SHOP["CLAUDE.md"],
      "# Reviewer\n",
      "# TDD\n",
      false,
      false,
      ["shop"],
    ]);
  });

  test("a file the scanner flags refuses the whole template, naming the file; nothing is stored", async () => {
    const { dir, templates } = store(["k3y-in-the-vault"]);
    const root = project({
      ...SHOP,
      ".claude/agents/reviewer.md": "# Reviewer\nk3y-in-the-vault\n",
    });
    const done = await outcome(templates.export(root, "shop", "Shop"));
    expect([done, existsSync(join(dir, "shop"))]).toEqual(["harness_template_secret", false]);
  });

  test("a taken id, a project with nothing to share, and a bad id are refused", async () => {
    const { templates } = store();
    await templates.export(project(SHOP), "shop", "Shop");
    expect([
      await outcome(templates.export(project(SHOP), "shop", "Again")),
      await outcome(templates.export(project({ "README.md": "# r\n" }), "empty", "Empty")),
      await outcome(templates.export(project(SHOP), "../up", "Up")),
    ]).toEqual(["harness_template_taken", "harness_template_empty", "harness_template_id"]);
  });

  test.skipIf(!posix)("a file reached through a link is not shared", async () => {
    const outside = join(tempDir("fd-harness-tpl-out-"), "CLAUDE.md");
    writeFileSync(outside, "# Outside\n");
    const root = project({ ".claude/agents/reviewer.md": "# Reviewer\n" });
    symlinkSync(outside, join(root, "CLAUDE.md"));
    const { templates } = store();
    const info = await templates.export(root, "linked", "Linked");
    expect(info.files).toEqual(["agents/reviewer.md"]);
  });
});
