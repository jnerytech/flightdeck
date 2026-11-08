import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { newBoard } from "./board-helpers.ts";
import { tempDir, waitFor } from "./helpers.ts";

/**
 * Issue #78, slice S-T3a: a trusted project's own spec template (`.flightdeck/templates/spec.md`,
 * read from its trusted checkout) replaces the built-in one; an untrusted project gets the built-in
 * one, since its template would reach the agent before the person trusted it.
 */
const SPEC = "docs/specs/login-screen.md";
const TEMPLATE = ".flightdeck/templates/spec.md";
const OURS = "# {{title}}\n\nOur shape.\n\n## Criteria\n\n{{criteria}}\n";
const posix = process.platform !== "win32";

/** Starts a card whose project asks for a spec; `trusted` decides whether the template is read. */
async function start(options: { trusted: boolean; template?: string; link?: boolean }) {
  let repo = "";
  const ctx = newBoard({
    specTemplateRoot: async () => (options.trusted ? repo : null),
  });
  repo = ctx.repo;
  mkdirSync(join(repo, ".flightdeck", "templates"), { recursive: true });
  if (options.link) {
    const outside = join(tempDir("fd-spec-template-out-"), "spec.md");
    writeFileSync(outside, OURS);
    symlinkSync(outside, join(repo, TEMPLATE));
  } else if (options.template !== undefined) {
    writeFileSync(join(repo, TEMPLATE), options.template);
  }
  const project = await ctx.board.addProject({ path: repo, promptTemplate: "" });
  ctx.board.updateProject(project.id, {
    contractByColumn: { review: { enforce: "confirm", checks: ["spec"] } },
  });
  const card = ctx.board.createCard(project.id, {
    title: "Login screen",
    description: "- [ ] signs in with email",
  });
  const prompts: string[] = [];
  const create = ctx.manager.create.bind(ctx.manager);
  ctx.manager.create = (async (opts: { prompt: string }, ...rest: unknown[]) => {
    prompts.push(opts.prompt);
    return (create as (...args: unknown[]) => unknown)(opts, ...rest);
  }) as typeof ctx.manager.create;
  await ctx.board.startCard(card.id);
  await waitFor(() => prompts[0], { label: "the first prompt" });
  const spec = join(ctx.board.getCard(card.id).worktreePath ?? "", SPEC);
  return existsSync(spec) ? readFileSync(spec, "utf8") : "";
}

describe("card-spec-template-project: a trusted project's own spec template (#78)", () => {
  test("a trusted project's template is used, with the draft front matter and the card's criteria", async () => {
    const text = await start({ trusted: true, template: OURS });
    expect([
      text.startsWith("---\n"),
      text.includes("draft: true"),
      text.includes("# Login screen"),
      text.includes("Our shape."),
      text.includes("- [ ] signs in with email"),
      // The built-in sections are not added to the project's own shape.
      text.includes("## Out of scope"),
    ]).toEqual([true, true, true, true, true, false]);
  });

  test("an untrusted project's template is not read: the built-in one is written", async () => {
    const text = await start({ trusted: false, template: OURS });
    expect([text.includes("Our shape."), text.includes("## Out of scope")]).toEqual([false, true]);
  });

  test.skipIf(!posix)(
    "a template that is a link is not followed: the built-in one is written",
    async () => {
      const text = await start({ trusted: true, link: true });
      expect([text.includes("Our shape."), text.includes("## Out of scope")]).toEqual([
        false,
        true,
      ]);
    },
  );

  test("a template too big, or empty, falls back to the built-in one", async () => {
    const big = await start({ trusted: true, template: `${OURS}${"x".repeat(40_000)}` });
    const empty = await start({ trusted: true, template: "" });
    expect([big.includes("## Out of scope"), empty.includes("## Out of scope")]).toEqual([
      true,
      true,
    ]);
  });
});
