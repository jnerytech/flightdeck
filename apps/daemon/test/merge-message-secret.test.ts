import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { SecretScanner } from "../src/snippets/model.ts";
import { newBoard } from "./board-helpers.ts";

setDefaultTimeout(30_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

/** A board that scans, with a card that was never started: both texts are refused before any git work. */
async function board() {
  const ctx = newBoard({ scanner: new SecretScanner() });
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
  const card = ctx.board.createCard(project.id, { title: "Integrar", description: "oi" });
  return { ...ctx, cardId: card.id };
}

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => ({ code: "ok", message: "" }),
    (error: { reason?: string; message?: string }) => ({
      code: error.reason ?? "no reason",
      message: error.message ?? "",
    }),
  );

describe("merge-message-secret: what goes public is scanned (issue #681)", () => {
  test("a merge message with a secret is refused by its own code, and the secret is not echoed", async () => {
    const ctx = await board();
    const refused = await refusal(
      ctx.board.mergeLocal(ctx.cardId, "squash", true, `Fix login with ${TOKEN}`),
    );
    expect(refused.code).toBe("merge_message_secret");
    expect(refused.message).not.toContain(TOKEN);
  });

  test("a PR title with a secret is refused by its own code, before anything is pushed, and the secret is not echoed", async () => {
    const ctx = await board();
    const refused = await refusal(ctx.board.createPr(ctx.cardId, { title: `Login ${TOKEN}` }));
    expect(refused.code).toBe("pr_title_secret");
    expect(refused.message).not.toContain(TOKEN);
  });

  test("the description is still refused by pr_secret", async () => {
    const ctx = await board();
    const refused = await refusal(ctx.board.createPr(ctx.cardId, { description: `uses ${TOKEN}` }));
    expect(refused.code).toBe("pr_secret");
  });

  test("the default PR title and body come from the card: a secret in either is refused too, before anything is pushed", async () => {
    const ctx = await board();
    ctx.store.db.query("UPDATE cards SET title = ? WHERE id = ?").run(`Fix ${TOKEN}`, ctx.cardId);
    const title = await refusal(ctx.board.createPr(ctx.cardId));
    expect(title.code).toBe("pr_title_secret");
    expect(title.message).not.toContain(TOKEN);
    ctx.store.db
      .query("UPDATE cards SET title = 'Integrar', description = ? WHERE id = ?")
      .run(`Uses ${TOKEN}`, ctx.cardId);
    const body = await refusal(ctx.board.createPr(ctx.cardId));
    expect(body.code).toBe("pr_secret");
    expect(body.message).not.toContain(TOKEN);
  });

  test("the default merge message comes from the card's title: a secret in it is refused, in a squash and in a merge", async () => {
    const ctx = await board();
    ctx.store.db.query("UPDATE cards SET title = ? WHERE id = ?").run(`Fix ${TOKEN}`, ctx.cardId);
    for (const mode of ["squash", "merge"] as const) {
      const refused = await refusal(ctx.board.mergeLocal(ctx.cardId, mode, true));
      expect(refused.code).toBe("merge_message_secret");
      expect(refused.message).not.toContain(TOKEN);
    }
  });
});
