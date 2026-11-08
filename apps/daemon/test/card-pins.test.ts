import { describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FlightdeckError } from "../src/errors.ts";
import { cardWhen, git, newBoard } from "./board-helpers.ts";
import { poll, record } from "./helpers.ts";

/** Issue #76: a card pins library documents; its first prompt names them. */
async function boardWithDocs(docs: Record<string, string>) {
  const ctx = newBoard();
  for (const [path, text] of Object.entries(docs)) {
    mkdirSync(dirname(join(ctx.repo, path)), { recursive: true });
    writeFileSync(join(ctx.repo, path), text);
  }
  if (Object.keys(docs).length > 0) {
    git(ctx.repo, "add", ...Object.keys(docs));
    git(ctx.repo, "commit", "-q", "-m", "docs");
  }
  const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "TEMPLATE" });
  const card = ctx.board.createCard(project.id, { title: "Pinned", description: "DESCRIPTION" });
  return { ...ctx, card };
}

/** The prompt of the card's first session once it has started: its first user message. */
async function startedPrompt(ctx: Awaited<ReturnType<typeof boardWithDocs>>) {
  await ctx.board.startCard(ctx.card.id);
  const started = await cardWhen(ctx.board, ctx.card.id, (c) => c.runs.some((r) => r.sessionId));
  const sessionId = started?.runs.find((r) => r.sessionId)?.sessionId ?? "";
  const rec = record(ctx.manager, sessionId);
  const first = await poll(() => rec.find("message.user")[0] ?? null, 5000);
  rec.unsubscribe();
  return first?.text ?? "";
}

const ADR = "docs/adr/0001-use-sqlite.md";
const SPEC = "docs/specs/login.md";

describe("card-pins: the documents a card pins (issue #76)", () => {
  test("pinned documents are kept in the order given, once each, and can be cleared", async () => {
    const ctx = await boardWithDocs({});
    const set = ctx.board.updateCard(ctx.card.id, { pinnedDocs: [SPEC, ADR, SPEC] });
    expect(set.pinnedDocs).toEqual([SPEC, ADR]);
    expect(ctx.board.getCard(ctx.card.id).pinnedDocs).toEqual([SPEC, ADR]);
    // A patch without the field leaves them; an empty list clears them.
    expect(ctx.board.updateCard(ctx.card.id, { title: "Other" }).pinnedDocs).toEqual([SPEC, ADR]);
    expect(ctx.board.updateCard(ctx.card.id, { pinnedDocs: [] }).pinnedDocs).toEqual([]);
  });

  test("a path outside the library, or more than ten, is refused with a reason and nothing changes", async () => {
    const ctx = await boardWithDocs({});
    ctx.board.updateCard(ctx.card.id, { pinnedDocs: [ADR] });
    const refuse = (docs: string[]) => {
      try {
        ctx.board.updateCard(ctx.card.id, { pinnedDocs: docs });
      } catch (error) {
        return error instanceof FlightdeckError ? error.reason : String(error);
      }
      return "accepted";
    };
    const eleven = Array.from({ length: 11 }, (_, i) => `docs/adr/${i}.md`);
    expect([refuse(["README.md"]), refuse(["docs/adr/../../x.md"]), refuse(eleven)]).toEqual([
      "pinned_doc_invalid",
      "pinned_doc_invalid",
      "pinned_doc_invalid",
    ]);
    expect(ctx.board.getCard(ctx.card.id).pinnedDocs).toEqual([ADR]);
  });

  test("the first prompt lists each pinned document with its title, between the description and the template", async () => {
    const ctx = await boardWithDocs({
      [ADR]: "---\nstatus: valid\n---\n# Use SQLite\n\nSECRET BODY\n",
      [SPEC]: "# Login flow\n",
    });
    ctx.board.updateCard(ctx.card.id, { pinnedDocs: [ADR, SPEC] });
    const prompt = await startedPrompt(ctx);
    const at = (text: string) => prompt.indexOf(text);
    expect(prompt).toContain(`- ${ADR}: Use SQLite`);
    expect(prompt).toContain(`- ${SPEC}: Login flow`);
    expect(at("DESCRIPTION")).toBeLessThan(at(ADR));
    expect(at(SPEC)).toBeLessThan(at("TEMPLATE"));
    // The contents of a document never go into the prompt: the session reads it itself.
    expect(prompt).not.toContain("SECRET BODY");
  });

  test("a card with no pins, or whose pins are not in the worktree, gets the prompt it always had", async () => {
    const none = await boardWithDocs({});
    const missing = await boardWithDocs({});
    missing.board.updateCard(missing.card.id, { pinnedDocs: [ADR] });
    const plain = "DESCRIPTION\n\nTEMPLATE";
    expect([await startedPrompt(none), await startedPrompt(missing)]).toEqual([plain, plain]);
  });

  test("a pinned name that is a link in the worktree is left out", async () => {
    const ctx = await boardWithDocs({ [SPEC]: "# Login flow\n" });
    mkdirSync(join(ctx.repo, "docs/adr"), { recursive: true });
    symlinkSync(join(ctx.repo, SPEC), join(ctx.repo, ADR));
    git(ctx.repo, "add", ADR);
    git(ctx.repo, "commit", "-q", "-m", "link");
    ctx.board.updateCard(ctx.card.id, { pinnedDocs: [ADR, SPEC] });
    const prompt = await startedPrompt(ctx);
    expect([prompt.includes(ADR), prompt.includes(`- ${SPEC}: Login flow`)]).toEqual([false, true]);
  });
});
