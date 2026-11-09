import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { detectProvider, providerOfRemote } from "../src/board/pr-provider.ts";
import type { AsyncGitRunner } from "../src/central/project-key.ts";
import { DaemonClient } from "../src/mcp.ts";
import { startServer } from "../src/server.ts";
import { git, newBoard } from "./board-helpers.ts";

setDefaultTimeout(30_000);

const boards: Array<{ stop(): void }> = [];
const closers: Array<() => unknown> = [];
afterEach(async () => {
  for (const board of boards.splice(0)) board.stop();
  for (const close of closers.splice(0).reverse()) await close();
});

describe("pr-provider: which PR provider a remote points to (issue #1568)", () => {
  test("GitHub in its usual forms, an enterprise host included", () => {
    for (const url of [
      "https://github.com/acme/app.git",
      "git@github.com:acme/app.git",
      "ssh://git@github.com:22/acme/app",
      "https://github.example.com/acme/app",
    ])
      expect(providerOfRemote(url).provider).toBe("github");
  });

  test("Azure DevOps in its usual forms", () => {
    for (const url of [
      "https://dev.azure.com/org/project/_git/repo",
      "git@ssh.dev.azure.com:v3/org/project/repo",
      "https://org.visualstudio.com/project/_git/repo",
    ])
      expect(providerOfRemote(url).provider).toBe("azure-devops");
  });

  test("another service, or no remote, is no provider; only the host name is kept", () => {
    expect(providerOfRemote("https://gitlab.com/acme/app.git")).toEqual({
      provider: null,
      host: "gitlab.com",
    });
    // Credentials in the address never reach the host name.
    expect(
      providerOfRemote("https://user:secret-token@gitlab.example.org:8443/acme/app.git"),
    ).toEqual({
      provider: null,
      host: "gitlab.example.org",
    });
    expect(providerOfRemote("git@bitbucket.org:acme/app.git").host).toBe("bitbucket.org");
    expect(providerOfRemote(null)).toEqual({ provider: null, host: null });
    expect(providerOfRemote("   ")).toEqual({ provider: null, host: null });
  });
});

describe("pr-provider: only a plain host name leaves, whatever the address holds (issue #1568)", () => {
  test("a password with an @ or a / in it, a port that is a word, a query and a bare word give no host", () => {
    const hostile = [
      "https://user:p@ss@gitlab.com/a/b",
      "https://user:tok/en@gitlab.com/a/b",
      "https://x:abc/def@evil.github.com/a/b",
      "https://gitlab.com:secret",
      "https://gitlab.com?token=abc/a",
      "secret",
      "https://example.com\n/x",
    ];
    for (const url of hostile) {
      const found = providerOfRemote(url);
      expect(found.host).toBeNull();
      expect(JSON.stringify(found)).not.toMatch(/secret|tok|abc|ss@|p@ss/);
    }
  });

  test("a plain host name, in any case and with a subdomain, is kept", () => {
    expect(providerOfRemote("https://GitLab.Example.ORG/a/b").host).toBe("gitlab.example.org");
    expect(providerOfRemote("git@git.corp.example.com:team/app.git").host).toBe(
      "git.corp.example.com",
    );
  });
});

describe("pr-provider: looking at the project's origin (issue #1568)", () => {
  const remote =
    (url: string | null): AsyncGitRunner =>
    async () =>
      url === null ? { code: 1, stdout: "" } : { code: 0, stdout: `${url}\n` };
  const project = { path: "/repo", prProvider: "none" };

  test("no remote, GitHub, Azure DevOps and another service each say what they are", async () => {
    expect(await detectProvider(project, remote(null))).toEqual({
      outcome: "no_remote",
      provider: null,
      host: null,
    });
    expect(await detectProvider(project, remote("https://github.com/acme/app.git"))).toEqual({
      outcome: "set",
      provider: "github",
      host: null,
    });
    expect((await detectProvider(project, remote("git@ssh.dev.azure.com:v3/o/p/r"))).provider).toBe(
      "azure-devops",
    );
    expect(await detectProvider(project, remote("https://gitlab.com/acme/app.git"))).toEqual({
      outcome: "unsupported",
      provider: null,
      host: "gitlab.com",
    });
  });

  test("a project that has a provider is left alone, and git is not even asked", async () => {
    let asked = 0;
    const counting: AsyncGitRunner = async () => {
      asked++;
      return { code: 0, stdout: "https://gitlab.com/a/b" };
    };
    const result = await detectProvider({ path: "/repo", prProvider: "azure-devops" }, counting);
    expect(result.outcome).toBe("kept");
    expect(asked).toBe(0);
  });

  test("a git that fails to run is no remote, not a crash", async () => {
    const broken: AsyncGitRunner = async () => {
      throw new Error("git not found");
    };
    expect((await detectProvider(project, broken)).outcome).toBe("no_remote");
  });
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

  test("an unknown project is refused", async () => {
    const { client } = await serve();
    const error = await client.call("project.detectProvider", { projectId: "nope" }).then(
      () => "answered",
      (e: Error) => e.message,
    );
    expect(error).toContain("not_found");
  });
});
