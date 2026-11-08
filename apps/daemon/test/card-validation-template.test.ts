import { describe, expect, test } from "bun:test";
import { linkSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { templateRootOf } from "../src/board/spec-template.ts";
import { newBoard } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";

/**
 * Issue #1058, slice 2: a project's own validation template (`.flightdeck/templates/validation.md`)
 * is read from its trusted checkout and given to the app as the shape of a validation note. An
 * untrusted project's is not read, and a template that is there but not used is said with its reason.
 */
const TEMPLATE = ".flightdeck/templates/validation.md";
const OURS = "What I ran:\n\nWhat I saw:\n";

async function ask(options: {
  trusted: boolean;
  template?: string;
  hardLink?: boolean;
  trustFails?: boolean;
}) {
  let repo = "";
  const ctx = newBoard({
    specTemplateRoot: async () => {
      if (options.trustFails) throw new Error("trust store unreadable");
      return templateRootOf(
        options.trusted ? { trusted: true, configRoot: repo } : { trusted: false },
      );
    },
  });
  repo = ctx.repo;
  mkdirSync(join(repo, ".flightdeck", "templates"), { recursive: true });
  if (options.hardLink) {
    const outside = join(tempDir("fd-validation-template-out-"), "validation.md");
    writeFileSync(outside, OURS);
    linkSync(outside, join(repo, TEMPLATE));
  } else if (options.template !== undefined) {
    writeFileSync(join(repo, TEMPLATE), options.template);
  }
  const project = await ctx.board.addProject({ path: repo, promptTemplate: "" });
  const card = ctx.board.createCard(project.id, { title: "Login screen", description: "" });
  return ctx.board.validationTemplate(card.id);
}

describe("card-validation-template: a project's own validation note shape (#1058)", () => {
  test("a trusted project's template is given as it is", async () => {
    expect(await ask({ trusted: true, template: OURS })).toEqual({ text: OURS, ignored: null });
  });

  test("a project with no template gives none and says nothing", async () => {
    expect(await ask({ trusted: true })).toEqual({ text: null, ignored: null });
    expect(await ask({ trusted: false })).toEqual({ text: null, ignored: null });
  });

  test("an untrusted project's template is not read: it is named as ignored", async () => {
    const seen = await ask({ trusted: false, template: OURS });
    expect(seen).toEqual({ text: null, ignored: "untrusted" });
  });

  test("a template that is too big, empty or has a second name is ignored with its reason", async () => {
    const big = await ask({ trusted: true, template: "x".repeat(40_000) });
    const empty = await ask({ trusted: true, template: " \n" });
    const hard = await ask({ trusted: true, hardLink: true });
    expect([big, empty, hard]).toEqual([
      { text: null, ignored: "too_big" },
      { text: null, ignored: "empty" },
      { text: null, ignored: "unsafe" },
    ]);
  });

  test("a trust check that fails gives none and names no template", async () => {
    expect(await ask({ trusted: true, template: OURS, trustFails: true })).toEqual({
      text: null,
      ignored: null,
    });
  });
});
