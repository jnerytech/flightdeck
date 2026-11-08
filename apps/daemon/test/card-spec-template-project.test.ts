import { describe, expect, test } from "bun:test";
import { existsSync, linkSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { templateRootOf } from "../src/board/spec-template.ts";
import { git, newBoard } from "./board-helpers.ts";
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
async function start(options: {
  trusted: boolean;
  template?: string;
  link?: boolean;
  hardLink?: boolean;
  /** The template committed on the base branch, so the card's worktree (its branch) carries it. */
  branchTemplate?: string;
  /** What the trust check does instead of answering. */
  trustFails?: boolean;
  log?: string[];
}) {
  let repo = "";
  const ctx = newBoard({
    specTemplateRoot: async () => {
      if (options.trustFails) throw new Error("trust store unreadable");
      // As main.ts asks: the trusted checkout of the card's project, never its branch.
      return templateRootOf(
        options.trusted ? { trusted: true, configRoot: repo } : { trusted: false },
      );
    },
    log: (line: string) => options.log?.push(line),
  });
  repo = ctx.repo;
  if (options.branchTemplate !== undefined) {
    mkdirSync(join(repo, ".flightdeck", "templates"), { recursive: true });
    writeFileSync(join(repo, TEMPLATE), options.branchTemplate);
    git(repo, "add", "--", TEMPLATE);
    git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "template");
  }
  mkdirSync(join(repo, ".flightdeck", "templates"), { recursive: true });
  if (options.link) {
    const outside = join(tempDir("fd-spec-template-out-"), "spec.md");
    writeFileSync(outside, OURS);
    symlinkSync(outside, join(repo, TEMPLATE));
  } else if (options.hardLink) {
    const outside = join(tempDir("fd-spec-template-out-"), "spec.md");
    writeFileSync(outside, OURS);
    linkSync(outside, join(repo, TEMPLATE));
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

  test("a template with a second name (a hard link, which may lie outside) is not read", async () => {
    const text = await start({ trusted: true, hardLink: true });
    expect([text.includes("Our shape."), text.includes("## Out of scope")]).toEqual([false, true]);
  });

  test("the template comes from the trusted checkout, never from the card's branch", async () => {
    // The branch carries one template; the trusted checkout has another, not committed.
    const text = await start({
      trusted: true,
      branchTemplate: "# {{title}}\n\nFrom the branch.\n",
      template: OURS,
    });
    expect([text.includes("Our shape."), text.includes("From the branch.")]).toEqual([true, false]);
  });

  test("the trust gate gives a root only for a trusted project that names its checkout", () => {
    expect([
      templateRootOf({ trusted: false }),
      templateRootOf({ trusted: true, configRoot: "/work/api" }),
      // No checkout named: never the worktree, whose content is the branch's.
      templateRootOf({ trusted: true }),
    ]).toEqual([null, "/work/api", null]);
  });

  test("a trust check that fails writes the built-in template and says so in the log, without the template", async () => {
    const log: string[] = [];
    const text = await start({ trusted: true, template: OURS, trustFails: true, log });
    expect([
      text.includes("## Out of scope"),
      log.some((line) => line.includes("spec template") && line.includes("trust store unreadable")),
      log.some((line) => line.includes("Our shape.")),
    ]).toEqual([true, true, false]);
  });

  test("a template too big, or empty, falls back to the built-in one", async () => {
    const big = await start({ trusted: true, template: `${OURS}${"x".repeat(40_000)}` });
    const empty = await start({ trusted: true, template: "" });
    expect([big.includes("## Out of scope"), empty.includes("## Out of scope")]).toEqual([
      true,
      true,
    ]);
  });
});
