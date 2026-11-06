import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cardDiff } from "../src/board/diff.ts";
import { aheadBehind, assertLocalBranch, mergeIntoBase, rebaseOnto } from "../src/board/merge.ts";
import { freshBase } from "../src/board/worktree.ts";
import { workflowSources } from "../src/workflows/repo.ts";
import { gitRepo, gitRepoWithOrigin, newBoard } from "./board-helpers.ts";

// Real git in temp repositories.
setDefaultTimeout(30_000);

const boards: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const board of boards.splice(0)) board.stop();
});

/** What a paired client could send as a base branch: git would take each of these for an option. */
const evil = (file: string) => [`--output=${file}`, `--exec=touch ${file}`, "-x", "-"];

/** Every helper that puts a base into git's arguments refuses it, and nothing is written. */
const helpers = (repo: string, remoteRepo: string) => ({
  aheadBehind: (base: string) => aheadBehind(repo, base),
  assertLocalBranch: (base: string) => assertLocalBranch(repo, base),
  rebaseOnto: (base: string) => rebaseOnto(repo, base),
  mergeIntoBase: (base: string) => mergeIntoBase(repo, base, "main", "merge", "m"),
  freshBase: (base: string) => freshBase(remoteRepo, base),
  workflowSources: (base: string) => workflowSources(repo, base),
  cardDiff: (base: string) => cardDiff(repo, base),
});

describe("git-arg-guard: a base branch that looks like an option never reaches git", () => {
  for (const name of [
    "aheadBehind",
    "assertLocalBranch",
    "rebaseOnto",
    "mergeIntoBase",
    "freshBase",
    "workflowSources",
    "cardDiff",
  ] as const) {
    test(`${name} refuses --output=, --exec= and a lone dash with branch_invalid, and writes nothing`, async () => {
      const { repo, root } = gitRepo();
      const origin = gitRepoWithOrigin();
      const sentinel = join(root, "written");
      for (const base of evil(sentinel)) {
        await expect(helpers(repo, origin.repo)[name](base)).rejects.toMatchObject({
          reason: "branch_invalid",
        });
      }
      expect(existsSync(sentinel)).toBe(false);
      expect(existsSync(`${sentinel}...HEAD`)).toBe(false);
      expect(existsSync(`${sentinel}:.flightdeck/workflows/`)).toBe(false);
    });
  }

  test("a real base still works: ahead and behind of main against itself is 0 and 0", async () => {
    const { repo } = gitRepo();
    expect(await aheadBehind(repo, "main")).toEqual({ ahead: 0, behind: 0 });
    await assertLocalBranch(repo, "main");
    expect(await workflowSources(repo, "main")).toEqual([]);
  });
});

describe("git-arg-guard: a project's base is checked when it is set, not only when git runs", () => {
  test("adding a project with an option as its base is refused and registers nothing", async () => {
    const ctx = newBoard();
    boards.push(ctx.board);
    await expect(
      ctx.board.addProject({ path: ctx.repo, promptTemplate: "", baseBranch: "--output=/tmp/x" }),
    ).rejects.toMatchObject({ reason: "branch_invalid", params: { name: "--output=/tmp/x" } });
    expect(ctx.board.listProjects()).toEqual([]);
  });

  test("updating a project's base to an option is refused and the base stays; a real branch name is taken", async () => {
    const ctx = newBoard();
    boards.push(ctx.board);
    const project = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    expect(() => ctx.board.updateProject(project.id, { baseBranch: "--exec=touch x" })).toThrow(
      expect.objectContaining({ reason: "branch_invalid" }) as never,
    );
    expect(ctx.board.getProject(project.id).baseBranch).toBe("main");
    expect(ctx.board.updateProject(project.id, { baseBranch: "release/1.2" }).baseBranch).toBe(
      "release/1.2",
    );
  });
});
