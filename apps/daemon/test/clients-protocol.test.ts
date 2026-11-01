import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Project, ProjectListResult } from "@flightdeck/protocol";
import { newBoard } from "./board-helpers.ts";

setDefaultTimeout(20_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

const wire = {
  id: "p1",
  path: "/r",
  name: "r",
  baseBranch: "main",
  prProvider: "none",
  setupScript: null,
  promptTemplate: "",
};

describe("clients-protocol: the project's key on the wire", () => {
  test("a project from a daemon that does not send it still parses, without a key", () => {
    const parsed = Project.safeParse(wire);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.projectKey).toBeUndefined();
  });

  test("a project keeps the key a daemon sends, in a list too", () => {
    const withKey = { ...wire, projectKey: "github.com/acme/api" };
    expect(Project.safeParse(withKey).data?.projectKey).toBe("github.com/acme/api");
    const list = ProjectListResult.safeParse({ projects: [withKey], maxParallelRuns: 2 });
    expect(list.data?.projects[0]?.projectKey).toBe("github.com/acme/api");
  });

  test("a key that is not text is refused", () => {
    expect(Project.safeParse({ ...wire, projectKey: 7 }).success).toBe(false);
  });
});

describe("clients-protocol: the daemon fills it", () => {
  test("every project the board gives out carries the key of its folder", async () => {
    const ctx = newBoard({ projectKeys: { keyFor: (path) => `remote-of:${path}` } });
    cleanups.push(() => ctx.board.stop());
    const added = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    const expected = `remote-of:${added.path}`;
    expect(added.projectKey).toBe(expected);
    expect(ctx.board.getProject(added.id).projectKey).toBe(expected);
    expect(ctx.board.listProjects()[0]?.projectKey).toBe(expected);
    expect(ctx.board.updateProject(added.id, { name: "renamed" }).projectKey).toBe(expected);
  });

  test("without the project keys of the central the field is left out, not guessed from the folder", async () => {
    const ctx = newBoard();
    cleanups.push(() => ctx.board.stop());
    const added = await ctx.board.addProject({ path: ctx.repo, promptTemplate: "" });
    expect("projectKey" in added).toBe(false);
    expect("projectKey" in (ctx.board.listProjects()[0] ?? {})).toBe(false);
  });
});
