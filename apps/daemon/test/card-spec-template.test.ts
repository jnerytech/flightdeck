import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { missingFor } from "@flightdeck/protocol";
import { readSpec } from "../src/board/spec.ts";
import { newBoard } from "./board-helpers.ts";
import { tempDir, waitFor } from "./helpers.ts";

/**
 * Issue #78, slice S-T1: a card whose project asks for a spec starts with one written from the
 * template, marked a draft, and its first prompt says spec first, then test first.
 */
const SPEC = "docs/specs/login-screen.md";

/** Commits `files` to the project's repository, so a card's worktree starts with them. */
function commit(repo: string, files: Record<string, string>) {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(repo, name, ".."), { recursive: true });
    writeFileSync(join(repo, name), text);
  }
  const git = (...args: string[]) =>
    Bun.spawnSync(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
  git("add", "--", ...Object.keys(files));
  git("commit", "-q", "-m", "files");
}

async function start(
  options: { asks?: boolean; description?: string; files?: Record<string, string> } = {},
) {
  const ctx = newBoard();
  if (options.files) commit(ctx.repo, options.files);
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  if (options.asks ?? true) {
    ctx.board.updateProject(project.id, {
      contractByColumn: { review: { enforce: "confirm", checks: ["pr", "checks", "spec"] } },
    });
  }
  const card = ctx.board.createCard(project.id, {
    title: "Login screen",
    description:
      options.description ?? "- [ ] signs in with email\n- [ ] says why a bad password fails",
  });
  const prompts: string[] = [];
  const create = ctx.manager.create.bind(ctx.manager);
  ctx.manager.create = (async (opts: { prompt: string }, ...rest: unknown[]) => {
    prompts.push(opts.prompt);
    return (create as (...args: unknown[]) => unknown)(opts, ...rest);
  }) as typeof ctx.manager.create;
  await ctx.board.startCard(card.id);
  const prompt = await waitFor(() => prompts[0], { label: "the first prompt" });
  const tree = ctx.board.getCard(card.id).worktreePath ?? "";
  const spec = join(tree, SPEC);
  const text = existsSync(spec) ? readFileSync(spec, "utf8") : null;
  return { ...ctx, card, prompt, tree, text };
}

describe("card-spec-template: a card that needs a spec starts with one, spec first and test first (#78)", () => {
  test("the template is written at the first start, as a draft, with the card's criteria", async () => {
    const { text, prompt } = await start();
    expect([
      text?.startsWith("---\n"),
      text?.includes("draft: true"),
      text?.includes("# Login screen"),
      text?.includes("- [ ] signs in with email"),
      text?.includes("- [ ] says why a bad password fails"),
      prompt.includes(SPEC),
      prompt.includes("failing test"),
    ]).toEqual([true, true, true, true, true, true, true]);
  });

  test("a draft spec does not meet the spec check; once draft goes, it does", async () => {
    const { board, card, tree } = await start();
    const asks = { review: { enforce: "confirm" as const, checks: ["spec" as const] } };
    const lacks = async () => {
      const seen = await board.refreshSpec(card.id);
      return [seen.specState?.draft, missingFor("review", seen, asks)];
    };
    const before = await lacks();
    const path = join(tree, SPEC);
    if (existsSync(path)) {
      writeFileSync(path, readFileSync(path, "utf8").replace("draft: true\n", ""));
    }
    const after = await lacks();
    expect([before, after]).toEqual([
      [true, ["spec"]],
      [undefined, []],
    ]);
  });

  test("a project that asks for no spec gets no file and no spec line", async () => {
    const { text, prompt } = await start({ asks: false });
    expect([text, prompt.includes("failing test")]).toEqual([null, false]);
  });

  test("a spec already there is never overwritten; the prompt points to it, and to the TDD skill", async () => {
    const mine = "# Mine\n\nWhat I wrote.\n";
    const { text, prompt } = await start({
      files: { [SPEC]: mine, ".claude/skills/tdd/SKILL.md": "# TDD\n" },
    });
    expect([text, prompt.includes(SPEC), prompt.includes("tdd skill")]).toEqual([mine, true, true]);
  });

  test("a spec that cannot be written does not stop the start; the card says so", async () => {
    // `docs/specs` is a file, so the folder for the spec cannot be made.
    const { board, card, prompt, text } = await start({
      files: { "docs/specs": "not a folder\n" },
    });
    expect([text, prompt.length > 0, board.getCard(card.id).notice?.includes("spec")]).toEqual([
      null,
      true,
      true,
    ]);
  });

  test("a criterion that names a placeholder stays as it is", async () => {
    const { text } = await start({ description: "- [ ] shows {{path}} and {{title}} literally" });
    expect(text?.includes("- [ ] shows {{path}} and {{title}} literally")).toBe(true);
  });
});

describe("card-spec-template: what the host reads of a spec's front matter", () => {
  test("draft: true in the front matter is the one thing read from it, and its lines are no heading", async () => {
    const root = tempDir("fd-spec-front-");
    writeFileSync(
      join(root, "draft.md"),
      "---\ncard: c1\ndraft: true\n# no heading\n---\n# Real\n",
    );
    writeFileSync(join(root, "ready.md"), "---\ncard: c1\ntitle: SECRET\n---\n# Ready\n");
    const draft = await readSpec(root, "draft.md");
    const ready = await readSpec(root, "ready.md");
    expect([draft, ready, JSON.stringify(ready).includes("SECRET")]).toEqual([
      { found: true, heading: "Real", draft: true },
      { found: true, heading: "Ready" },
      false,
    ]);
  });
});
