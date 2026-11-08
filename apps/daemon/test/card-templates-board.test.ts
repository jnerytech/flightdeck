import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { templateRootOf } from "../src/board/spec-template.ts";
import { FlightdeckError } from "../src/errors.ts";
import { newBoard } from "./board-helpers.ts";

/**
 * Issue #1201: a trusted project's card templates (`.flightdeck/templates/cards.json`) are offered
 * by the host, and a card made from one gets its workflow, persona, pins and spec file, and its
 * criteria when the person typed no text. An untrusted project's file is not read.
 */
const FILE = ".flightdeck/templates/cards.json";
const BUG = {
  id: "bug",
  name: "Bug fix",
  description: "Fix it.",
  criteria: ["a test fails first"],
  workflow: "fix",
  persona: "reviewer",
  pins: ["docs/adr/0001-style.md"],
  spec: "docs/specs/bug.md",
};

async function project(options: { trusted?: boolean; file?: string } = {}) {
  const ctx = newBoard({
    specTemplateRoot: async (cwd, own) =>
      templateRootOf(
        options.trusted === false ? { trusted: false } : { trusted: true },
        own ? cwd : undefined,
      ),
  });
  if (options.file !== undefined) {
    mkdirSync(join(ctx.repo, ".flightdeck", "templates"), { recursive: true });
    writeFileSync(join(ctx.repo, FILE), options.file);
  }
  const made = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  return { board: ctx.board, projectId: made.id };
}

const refusal = async (call: () => Promise<unknown>) => {
  const error = await call().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(FlightdeckError);
  return error as FlightdeckError;
};

describe("card-templates-board: the host offers a project's card templates (#1201)", () => {
  test("a trusted project's templates are offered as written, with how many entries were left out", async () => {
    const { board, projectId } = await project({ file: JSON.stringify([BUG, { id: "" }]) });
    expect(await board.cardTemplates(projectId)).toEqual({
      templates: [
        {
          id: "bug",
          name: "Bug fix",
          description: "Fix it.\n\n- [ ] a test fails first",
          workflow: "fix",
          persona: "reviewer",
          pins: ["docs/adr/0001-style.md"],
          spec: "docs/specs/bug.md",
        },
      ],
      dropped: 1,
      ignored: null,
    });
  });

  test("a project with no file offers none and says nothing", async () => {
    const { board, projectId } = await project();
    expect(await board.cardTemplates(projectId)).toEqual({
      templates: [],
      dropped: 0,
      ignored: null,
    });
  });

  test("an untrusted project's file is not read: it is named as ignored", async () => {
    const { board, projectId } = await project({ trusted: false, file: JSON.stringify([BUG]) });
    expect(await board.cardTemplates(projectId)).toEqual({
      templates: [],
      dropped: 0,
      ignored: "untrusted",
    });
  });

  test("a file that is not a list, is empty or is too big is ignored with its reason", async () => {
    const reasons = [];
    for (const file of ["{}", " \n", `[${" ".repeat(40_000)}]`]) {
      const { board, projectId } = await project({ file });
      reasons.push((await board.cardTemplates(projectId)).ignored);
    }
    expect(reasons).toEqual(["invalid", "empty", "too_big"]);
  });
});

describe("card-templates-board: a card made from a template (#1201)", () => {
  test("has all five filled: the text, the workflow, the persona, the pins and the spec file", async () => {
    const { board, projectId } = await project({ file: JSON.stringify([BUG]) });
    const card = await board.createCardFrom(projectId, {
      title: "Login fails",
      description: "",
      templateId: "bug",
    });
    expect({
      description: card.description,
      startWorkflow: card.startWorkflow,
      startPersona: card.startPersona,
      pinnedDocs: card.pinnedDocs,
      specPath: card.specPath,
    }).toEqual({
      description: "Fix it.\n\n- [ ] a test fails first",
      startWorkflow: "fix",
      startPersona: "reviewer",
      pinnedDocs: ["docs/adr/0001-style.md"],
      specPath: "docs/specs/bug.md",
    });
  });

  test("keeps the text the person typed over the template's", async () => {
    const { board, projectId } = await project({ file: JSON.stringify([BUG]) });
    const card = await board.createCardFrom(projectId, {
      title: "Login fails",
      description: "My own words",
      templateId: "bug",
    });
    expect([card.description, card.startWorkflow]).toEqual(["My own words", "fix"]);
  });

  test("is born in the column asked for", async () => {
    const { board, projectId } = await project({ file: JSON.stringify([BUG]) });
    const card = await board.createCardFrom(projectId, {
      title: "Login fails",
      description: "",
      templateId: "bug",
      column: "review",
    });
    expect(card.column).toBe("review");
  });

  test("a card made with no template has no workflow, persona, pins or spec", async () => {
    const { board, projectId } = await project({ file: JSON.stringify([BUG]) });
    const card = await board.createCardFrom(projectId, { title: "Plain", description: "x" });
    expect([card.startWorkflow, card.startPersona, card.pinnedDocs, card.specPath]).toEqual([
      null,
      null,
      [],
      null,
    ]);
  });

  test("a template the project does not offer refuses the card and makes none", async () => {
    const { board, projectId } = await project({ file: JSON.stringify([BUG]) });
    const error = await refusal(() =>
      board.createCardFrom(projectId, { title: "x", description: "", templateId: "nope" }),
    );
    expect([
      error.code,
      error.reason,
      board.getBoard(projectId).columns.flatMap((c) => c.cards).length,
    ]).toEqual(["bad_request", "card_template_unknown", 0]);
  });

  test("an untrusted project's template cannot be used, though the file is there", async () => {
    const { board, projectId } = await project({ trusted: false, file: JSON.stringify([BUG]) });
    const error = await refusal(() =>
      board.createCardFrom(projectId, { title: "x", description: "", templateId: "bug" }),
    );
    expect(error.reason).toBe("card_template_unknown");
  });
});

describe("card-templates-board: createCard judges what it stores (#1201)", () => {
  test("a spec path outside the worktree or a pin outside the library makes no card", async () => {
    const { board, projectId } = await project();
    const made = [];
    for (const extra of [{ specPath: "../outside.md" }, { pinnedDocs: ["README.md"] }]) {
      const error = await refusal(async () =>
        board.createCard(projectId, { title: "x", description: "", ...extra }),
      );
      made.push([error.code, error.reason]);
    }
    expect([made, board.getBoard(projectId).columns.flatMap((c) => c.cards).length]).toEqual([
      [
        ["bad_request", "spec_path_invalid"],
        ["bad_request", "pinned_doc_invalid"],
      ],
      0,
    ]);
  });
});
