import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { detectProvider, providerOfRemote } from "../../src/board/pr-provider.ts";
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

describe("pr-provider: which PR provider a remote points to (issue #1568)", () => {
  test("GitHub in its usual forms, an enterprise host included", () => {
    for (const url of [
      "https://github.com/acme/app.git",
      "git@github.com:acme/app.git",
      "ssh://git@github.com:22/acme/app",
      "https://acme.ghe.com/acme/app",
    ])
      expect(providerOfRemote(url).provider).toBe("github");
  });

  test("Azure DevOps needs its own hosts too: an encoded slash cannot make another host one", () => {
    for (const url of [
      "https://evil.com%2F.visualstudio.com/org/proj",
      "https://a%2Fb.visualstudio.com/p",
      "https://visualstudio.com.evil.test/org/proj",
    ])
      expect(providerOfRemote(url).provider).toBeNull();
    expect(providerOfRemote("https://acme.visualstudio.com/proj/_git/repo").provider).toBe(
      "azure-devops",
    );
  });

  test("a host that only has github in its name is not GitHub: an enterprise server is set by hand", () => {
    for (const url of [
      "https://github.evil.test/acme/app",
      "https://notgithub.io/acme/app",
      "https://github.com.evil.test/acme/app",
      "https://githubx.com/acme/app",
      "https://github.example.com/acme/app",
    ]) {
      const found = providerOfRemote(url);
      expect(found.provider).toBeNull();
      expect(found.host).not.toBeNull();
    }
  });

  test("a host with no dot is a host; an address that is a path has none", () => {
    expect(providerOfRemote("https://gitserver/team/app.git").host).toBe("gitserver");
    expect(providerOfRemote("ssh://git@localhost/team/app.git").host).toBe("localhost");
    for (const url of ["/srv/git/app.git", "file:///srv/git/app.git", "C:\\repos\\app"])
      expect(providerOfRemote(url).host).toBeNull();
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

  test("git failing to read the repository is not 'no remote': it is unreadable, with no advice to add one", async () => {
    const broken: AsyncGitRunner = async () => {
      throw new Error("git not found");
    };
    expect((await detectProvider(project, broken)).outcome).toBe("unreadable");
    const notRepo: AsyncGitRunner = async () => ({ code: 128, stdout: "" });
    expect((await detectProvider(project, notRepo)).outcome).toBe("unreadable");
    // Exit 1 is git's own answer for a key that is not there.
    const noKey: AsyncGitRunner = async () => ({ code: 1, stdout: "" });
    expect((await detectProvider(project, noKey)).outcome).toBe("no_remote");
  });

  test("a git that never answers is unreadable after the time given", async () => {
    const hung: AsyncGitRunner = () => new Promise(() => {});
    const started = Date.now();
    expect((await detectProvider(project, hung, 60)).outcome).toBe("unreadable");
    expect(Date.now() - started).toBeLessThan(2000);
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
