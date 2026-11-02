import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { removeRule } from "../src/board/project-rules.ts";
import { FlightdeckError } from "../src/errors.ts";
import { newBoard } from "./board-helpers.ts";

/** The reason and params of the refusal a call ends in; the detail is for logs, in English. */
async function refused(call: () => unknown) {
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(FlightdeckError);
    const { code, reason, params, message } = error as FlightdeckError;
    // Nothing of the old Portuguese details is left.
    expect(message).not.toMatch(/[ãõçáéíóú]/);
    return { code, reason, params };
  }
  throw new Error("it did not refuse");
}

async function withCard() {
  const ctx = newBoard();
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const card = ctx.board.createCard(project.id, { title: "t", description: "d" });
  return { ...ctx, project, card };
}

describe("recusas-board: the board's refusals say why", () => {
  test("a project or card the host does not have", async () => {
    const { board, root } = await withCard();
    expect(await refused(() => board.getCard("nope"))).toMatchObject({
      code: "not_found",
      reason: "card_not_found",
      params: { id: "nope" },
    });
    const plain = join(root, "plain");
    mkdirSync(plain);
    expect(
      await refused(() => board.addProject({ path: plain, promptTemplate: "" })),
    ).toMatchObject({
      reason: "repo_not_git",
      params: { path: plain },
    });
  });

  test("registering a project twice", async () => {
    const { board, repo } = await withCard();
    const again = await refused(() => board.addProject({ path: repo, promptTemplate: "" }));
    expect(again.reason).toBe("project_exists");
    expect(again.params?.path).toBeString();
  });

  test("a project patch with a column or persona that does not exist", async () => {
    const { board, project } = await withCard();
    expect(
      await refused(() =>
        board.updateProject(project.id, { personaByColumn: { nope: "qa" } } as never),
      ),
    ).toMatchObject({ reason: "column_unknown", params: { column: "nope" } });
    expect(
      await refused(() =>
        board.updateProject(project.id, { personaByColumn: { review: "Not An Id!" } } as never),
      ),
    ).toMatchObject({ reason: "persona_id_invalid" });
    expect(
      await refused(() => board.updateProject(project.id, { personaSubagents: "some" } as never)),
    ).toMatchObject({ reason: "persona_subagents_invalid" });
  });

  test("the destructive steps wait for the person's confirmation", async () => {
    const { board, project, card } = await withCard();
    expect((await refused(() => board.completeCard(card.id, false))).reason).toBe(
      "complete_confirm",
    );
    expect((await refused(() => board.discardCard(card.id, false))).reason).toBe("discard_confirm");
    expect((await refused(() => board.mergeLocal(card.id, "merge", false))).reason).toBe(
      "merge_confirm",
    );
    expect((await refused(() => board.removeRule(project.id, "Bash(ls)", false))).reason).toBe(
      "rule_remove_confirm",
    );
    expect((await refused(() => board.chooseVariant(card.id, "v", false))).reason).toBe(
      "arena_choose_confirm",
    );
  });

  test("a card that was not started has no worktree, session or PR to work on", async () => {
    const { board, card } = await withCard();
    expect((await refused(() => board.diff(card.id))).reason).toBe("card_no_worktree");
    expect((await refused(() => board.message(card.id, "oi"))).reason).toBe("card_no_session");
    expect((await refused(() => board.prComments(card.id))).reason).toBe("card_no_pr");
  });

  test("an arena needs two to four variants", async () => {
    const { board, card } = await withCard();
    expect((await refused(() => board.startArena(card.id, { variants: [{}] }))).reason).toBe(
      "arena_variants",
    );
  });

  test("a rule the project does not have", async () => {
    const { repo } = await withCard();
    expect(await refused(() => removeRule(repo, "Bash(ls)"))).toMatchObject({
      code: "not_found",
      reason: "rule_not_found",
      params: { rule: "Bash(ls)" },
    });
  });
});
