import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { cardWhen, git, newBoard } from "./board-helpers.ts";

setDefaultTimeout(20_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

/** A card in review with a GitHub project whose base branch an older daemon stored as `base`. */
async function cardWithStoredBase(base: string) {
  const gh = installFakeCli("gh", [
    { args: ["view", "url"], code: 1 },
    { args: ["pr", "create"], stdout: "https://github.com/acme/repo/pull/9\n" },
  ]);
  cleanups.push(gh.restore);
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({
    path: ctx.repo,
    prProvider: "github",
    promptTemplate: "",
  });
  const card = ctx.board.createCard(project.id, { title: "PR", description: "faça" });
  await ctx.board.startCard(card.id);
  expect(await cardWhen(ctx.board, card.id, (c) => c.column === "review")).not.toBeNull();
  git(ctx.root, "init", "-q", "--bare", "remote.git");
  git(ctx.repo, "remote", "add", "origin", join(ctx.root, "remote.git"));
  ctx.store.db.query("UPDATE projects SET base_branch = ? WHERE id = ?").run(base, project.id);
  return { ctx, gh, card };
}

describe("rev-pr: a stored base is checked before it is sent to a PR provider (issue #369)", () => {
  test("a base that az would read as a file, or git would read as an option, never reaches the provider", async () => {
    for (const base of ["@/tmp/secret", "--head=x", "a:b"]) {
      const { ctx, gh, card } = await cardWithStoredBase(base);
      await expect(ctx.board.createPr(card.id)).rejects.toMatchObject({ reason: "branch_invalid" });
      expect(
        gh.calls().some((args) => args.includes("create")),
        base,
      ).toBe(false);
    }
  });

  test("a real base still opens the PR", async () => {
    const { ctx, gh, card } = await cardWithStoredBase("main");
    const opened = await ctx.board.createPr(card.id);
    expect(opened.prUrl).toBe("https://github.com/acme/repo/pull/9");
    expect(gh.calls().some((args) => args.includes("create"))).toBe(true);
  });
});
