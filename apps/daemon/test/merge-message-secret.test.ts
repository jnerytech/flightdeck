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
});
