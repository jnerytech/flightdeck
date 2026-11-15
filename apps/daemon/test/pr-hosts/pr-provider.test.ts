import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { AsyncGitRunner } from "../../src/central/project-key.ts";
import { DaemonClient } from "../../src/daemon-client/client.ts";
import { startServer } from "../../src/server.ts";
import { git, newBoard } from "../support/board-helpers.ts";

setDefaultTimeout(30_000);

const boards: Array<{ stop(): void }> = [];
const closers: Array<() => unknown> = [];
afterEach(async () => {
  for (const board of boards.splice(0)) board.stop();
  for (const close of closers.splice(0).reverse()) await close();
});

describe("pr-provider: project.detectProvider on a real repository (issue #1568)", () => {
  async function serve() {
    const ctx = newBoard();
    boards.push(ctx.board);
    const server = startServer({
      manager: ctx.manager,
      board: ctx.board,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: "detect-token-0123456789abcdef",
      allowedRoots: [ctx.root],
    });
    closers.push(() => server.stop());
    const client = await DaemonClient.connect(server.url, "detect-token-0123456789abcdef", "test");
    closers.push(() => client.close());
    const project = await ctx.board.addProject({ path: ctx.repo });
    return { ...ctx, client, project };
  }

  test("no remote, then a remote added: the provider is read and saved, and a second look keeps it", async () => {
    const { client, project, repo, board } = await serve();
    const none = await client.call("project.detectProvider", { projectId: project.id });
    expect([none.outcome, none.host, none.project.prProvider]).toEqual(["no_remote", null, "none"]);

    git(repo, "remote", "add", "origin", "https://github.com/acme/app.git");
    const found = await client.call("project.detectProvider", { projectId: project.id });
    expect([found.outcome, found.host, found.project.prProvider]).toEqual(["set", null, "github"]);
    expect(board.getProject(project.id).prProvider).toBe("github");

    const again = await client.call("project.detectProvider", { projectId: project.id });
    expect([again.outcome, again.project.prProvider]).toEqual(["kept", "github"]);
  });

  test("a remote on another service is said, with its host and nothing more", async () => {
    const { client, project, repo, board } = await serve();
    git(repo, "remote", "add", "origin", "https://me:hunter2@gitlab.com/acme/app.git");
    const result = await client.call("project.detectProvider", { projectId: project.id });
    expect([result.outcome, result.host]).toEqual(["unsupported", "gitlab.com"]);
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(board.getProject(project.id).prProvider).toBe("none");
  });

  test("the person sets the provider by hand while git is reading: detection does not overwrite it", async () => {
    const ctx = newBoard();
    boards.push(ctx.board);
    const project = await ctx.board.addProject({ path: ctx.repo });
    const slowGit: AsyncGitRunner = async () => {
      // The project form saves while git is still running.
      ctx.board.updateProject(project.id, { prProvider: "azure-devops" });
      return { code: 0, stdout: "https://github.com/acme/app.git\n" };
    };
    const server = startServer({
      manager: ctx.manager,
      board: ctx.board,
      hostName: "h",
      bind: "127.0.0.1",
      port: 0,
      token: "detect-token-0123456789abcdef",
      allowedRoots: [ctx.root],
      projectGit: slowGit,
    });
    closers.push(() => server.stop());
    const client = await DaemonClient.connect(server.url, "detect-token-0123456789abcdef", "test");
    closers.push(() => client.close());
    const result = await client.call("project.detectProvider", { projectId: project.id });
    expect([result.outcome, result.project.prProvider]).toEqual(["kept", "azure-devops"]);
    expect(ctx.board.getProject(project.id).prProvider).toBe("azure-devops");
  });

  test("a field the command does not know is refused", async () => {
    const { client, project } = await serve();
    const error = await client
      .call("project.detectProvider", { projectId: project.id, extra: 1 } as never)
      .then(
        () => "answered",
        (e: Error) => e.message,
      );
    expect(error).not.toBe("answered");
  });

  test("an unknown project is refused", async () => {
    const { client } = await serve();
    const error = await client.call("project.detectProvider", { projectId: "nope" }).then(
      () => "answered",
      (e: Error) => e.message,
    );
    expect(error).toContain("not_found");
  });
});
