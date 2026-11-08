import { describe, expect, test } from "bun:test";
import { existsSync, linkSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { templateRootOf, untrustedTemplate } from "../src/board/spec-template.ts";
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

/**
 * Starts a card whose project asks for a spec; `trusted` decides whether the template is read.
 * Gives the spec written and the notice the card was left with.
 */
async function run(options: {
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
  const made = ctx.board.getCard(card.id);
  const spec = join(made.worktreePath ?? "", SPEC);
  return {
    text: existsSync(spec) ? readFileSync(spec, "utf8") : "",
    notice: made.notice ?? null,
    reason: made.noticeReason ?? null,
  };
}

/** Just the spec written. */
const start = async (options: Parameters<typeof run>[0]) => (await run(options)).text;

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
      // The project's own folder (a card with no worktree) is the checkout itself, when trusted.
      templateRootOf({ trusted: true }, "/work/api"),
      templateRootOf({ trusted: false }, "/work/api"),
      templateRootOf({ trusted: true, configRoot: "/work/main" }, "/work/api"),
    ]).toEqual([null, "/work/api", null, "/work/api", null, "/work/main"]);
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

  test("a template that is ignored is said on the card, with its reason and without its text", async () => {
    const big = await run({ trusted: true, template: `${OURS}${"x".repeat(40_000)}` });
    const empty = await run({ trusted: true, template: " \n" });
    const hard = await run({ trusted: true, hardLink: true });
    const untrusted = await run({ trusted: false, branchTemplate: OURS });
    expect([big.reason, empty.reason, hard.reason, untrusted.reason]).toEqual([
      "spec_template_too_big",
      "spec_template_empty",
      "spec_template_unsafe",
      "spec_template_untrusted",
    ]);
    // The run went on with the built-in template, and the notice carries no text of the template.
    expect([big, empty, hard, untrusted].map((r) => r.text.includes("## Out of scope"))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect([big, empty, hard, untrusted].some((r) => r.notice?.includes("Our shape."))).toBe(false);
  });

  test.skipIf(!posix)("a template that is a link is said as unsafe", async () => {
    const link = await run({ trusted: true, link: true });
    expect(link.reason).toBe("spec_template_unsafe");
  });

  test.skipIf(!posix)(
    "a link on the way to an untrusted template is not followed: what it points at is not told",
    async () => {
      // Two worktrees whose `.flightdeck` is a link, to a folder with a template and to one without.
      const linked = async (withTemplate: boolean) => {
        const outside = tempDir("fd-spec-template-folder-");
        mkdirSync(join(outside, "templates"), { recursive: true });
        if (withTemplate) writeFileSync(join(outside, "templates", "spec.md"), OURS);
        const worktree = tempDir("fd-spec-template-worktree-");
        symlinkSync(outside, join(worktree, ".flightdeck"));
        return untrustedTemplate(worktree);
      };
      expect(await linked(true)).toBe(await linked(false));
    },
  );

  test("a trust check that fails says nothing about the template: it was never looked for", async () => {
    const failed = await run({
      trusted: true,
      template: OURS,
      branchTemplate: OURS,
      trustFails: true,
      log: [],
    });
    expect(failed.reason).toBeNull();
  });

  test("a template that is used, or none at all, says nothing", async () => {
    const used = await run({ trusted: true, template: OURS });
    const none = await run({ trusted: true });
    const noneUntrusted = await run({ trusted: false });
    expect([used.reason, none.reason, noneUntrusted.reason]).toEqual([null, null, null]);
  });
});
