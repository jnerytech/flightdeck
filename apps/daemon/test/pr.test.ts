import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { AzureDevOpsCli, GithubCli } from "../src/board/pr.ts";
import type { PrProviderKind } from "../src/board/types.ts";
import { Config, loadConfig } from "../src/config.ts";
import { cardWhen, git, newBoard } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";

// Real git and fake CLIs (each one a Bun process) in several waits: more than the default 5 s.
setDefaultTimeout(20_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

function fake(name: string, rules: FakeRule[]): FakeCli {
  const cli = installFakeCli(name, rules);
  cleanups.push(cli.restore);
  return cli;
}

const GH_URL = "https://github.com/acme/repo/pull/7";
const AZ_WEB = "https://dev.azure.com/acme/proj/_git/repo";
const ghStatus = (state: string, rollup: unknown[] = []) => ({
  args: ["view", "state,statusCheckRollup"],
  stdout: JSON.stringify({ state, statusCheckRollup: rollup }),
});

/** Started card whose agent committed a file, in a repo whose origin is a local bare repo. */
async function cardWithWork(prProvider: PrProviderKind) {
  const ctx = newBoard({ prPollIntervalMs: 30 });
  cleanups.push(() => ctx.board.stop());
  const remote = join(ctx.root, "remote.git");
  git(ctx.root, "init", "-q", "--bare", "remote.git");
  git(ctx.repo, "remote", "add", "origin", remote);
  // Push only to local remotes: check where origin points before anything is pushed.
  expect(git(ctx.repo, "remote", "get-url", "origin")).toBe(remote);
  expect(existsSync(join(remote, "HEAD"))).toBe(true);
  git(ctx.repo, "push", "-q", "origin", "main");
  const project = await ctx.board.addProject({ path: ctx.repo, prProvider, promptTemplate: "" });
  const card = ctx.board.createCard(project.id, {
    title: "Adicionar arquivo",
    description: "Cria o arquivo novo",
  });
  await ctx.board.startCard(card.id);
  const started = await cardWhen(ctx.board, card.id, (c) => c.column === "review");
  const worktree = started?.worktreePath ?? ctx.repo;
  writeFileSync(join(worktree, "novo.txt"), "novo\n");
  git(worktree, "add", "novo.txt");
  git(worktree, "commit", "-q", "-m", "arquivo novo");
  return { ...ctx, remote, card, branch: started?.branch ?? "" };
}

describe("pr: GitHub", () => {
  test("push para o remoto local e gh pr create com título e descrição; mesclado leva a Concluído", async () => {
    const gh = fake("gh", [
      { args: ["view", "url"], code: 1 },
      { args: ["pr", "create"], stdout: `Creating pull request\n${GH_URL}\n` },
      ghStatus("OPEN", [{ conclusion: "SUCCESS" }, { status: "IN_PROGRESS", conclusion: null }]),
    ]);
    const { board, card, branch, remote, repo } = await cardWithWork("github");
    expect(branch).toBe("fd/adicionar-arquivo");
    const opened = await board.createPr(card.id);
    expect(opened).toMatchObject({ prUrl: GH_URL, prState: "open", column: "review" });
    expect(git(remote, "branch", "--list", "fd/*")).toContain("fd/adicionar-arquivo");
    expect(gh.calls().slice(0, 2)).toEqual([
      ["pr", "view", branch, "--json", "url"],
      [
        "pr",
        "create",
        "--base",
        "main",
        "--head",
        branch,
        "--title",
        "Adicionar arquivo",
        "--body",
        "Cria o arquivo novo",
      ],
    ]);
    expect(await cardWhen(board, card.id, (c) => c.checksState === "pending")).not.toBeNull();
    expect(gh.calls()[2]).toEqual(["pr", "view", GH_URL, "--json", "state,statusCheckRollup"]);
    // Polls run from the project's repository: a cwd inside the worktree would lock it on Windows
    // while Concluir or Descartar removes it.
    expect(gh.cwds()[2]).toBe(repo);
    gh.respond([ghStatus("MERGED", [{ conclusion: "SUCCESS" }])]);
    const merged = await cardWhen(board, card.id, (c) => c.prState === "merged");
    expect(merged).toMatchObject({ column: "done", checksState: "passing" });
  });

  test("PR já aberto para a branch é reaproveitado, sem gh pr create", async () => {
    const gh = fake("gh", [
      { args: ["view", "url"], stdout: JSON.stringify({ url: GH_URL }) },
      ghStatus("OPEN"),
    ]);
    const { board, card } = await cardWithWork("github");
    const opened = await board.createPr(card.id);
    expect(opened.prUrl).toBe(GH_URL);
    expect(gh.calls().some((c) => c.includes("create"))).toBe(false);
  });

  test("estado e checks do gh", async () => {
    fake("gh", [
      { args: ["view", "u1"], stdout: JSON.stringify({ state: "OPEN", statusCheckRollup: [] }) },
      {
        args: ["view", "u2"],
        stdout: JSON.stringify({
          state: "OPEN",
          statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }],
        }),
      },
      {
        args: ["view", "u3"],
        stdout: JSON.stringify({ state: "CLOSED", statusCheckRollup: [{ state: "SUCCESS" }] }),
      },
      { args: ["view", "u4"], stdout: JSON.stringify({ state: "MERGED" }) },
    ]);
    const gh = new GithubCli();
    const cwd = tempDir();
    expect(await gh.status({ cwd, url: "u1" })).toEqual({ state: "open", checks: null });
    expect(await gh.status({ cwd, url: "u2" })).toEqual({ state: "open", checks: "failing" });
    expect(await gh.status({ cwd, url: "u3" })).toEqual({ state: "closed", checks: "passing" });
    expect(await gh.status({ cwd, url: "u4" })).toEqual({ state: "merged", checks: null });
  });
});

describe("pr: Azure DevOps", () => {
  test("az repos pr create com as branches, título e descrição; fechado sem merge leva a Esperando você", async () => {
    // `az repos pr policy list` also has "pr" and "list": its rule comes first.
    const az = fake("az", [
      { args: ["policy", "list"], stdout: JSON.stringify([{ status: "approved" }]) },
      { args: ["pr", "list"], stdout: "[]" },
      {
        args: ["pr", "create"],
        stdout: JSON.stringify({ pullRequestId: 12, repository: { webUrl: AZ_WEB } }),
      },
      { args: ["pr", "show"], stdout: JSON.stringify({ status: "active" }) },
    ]);
    const { board, card, branch } = await cardWithWork("azure-devops");
    const opened = await board.createPr(card.id);
    expect(opened).toMatchObject({ prUrl: `${AZ_WEB}/pullrequest/12`, prState: "open" });
    expect(az.calls().slice(0, 2)).toEqual([
      ["repos", "pr", "list", "--source-branch", branch, "--status", "active", "--output", "json"],
      [
        "repos",
        "pr",
        "create",
        "--source-branch",
        branch,
        "--target-branch",
        "main",
        "--title",
        "Adicionar arquivo",
        "--description",
        "Cria o arquivo novo",
        "--output",
        "json",
      ],
    ]);
    expect(await cardWhen(board, card.id, (c) => c.checksState === "passing")).not.toBeNull();
    expect(az.calls()).toContainEqual(["repos", "pr", "show", "--id", "12", "--output", "json"]);
    az.respond([
      { args: ["pr", "show"], stdout: JSON.stringify({ status: "abandoned" }) },
      { args: ["policy", "list"], stdout: "[]" },
    ]);
    const closed = await cardWhen(board, card.id, (c) => c.prState === "closed");
    expect(closed).toMatchObject({ column: "waiting", checksState: null });
  });

  test("estado, políticas e PR existente do az", async () => {
    fake("az", [
      { args: ["policy", "1"], stdout: JSON.stringify([{ status: "rejected" }]) },
      {
        args: ["policy", "2"],
        stdout: JSON.stringify([{ status: "approved" }, { status: "running" }]),
      },
      { args: ["show", "1"], stdout: JSON.stringify({ status: "completed" }) },
      { args: ["show", "2"], stdout: JSON.stringify({ status: "active" }) },
      {
        args: ["pr", "list"],
        stdout: JSON.stringify([{ pullRequestId: 3, repository: { webUrl: AZ_WEB } }]),
      },
    ]);
    const az = new AzureDevOpsCli();
    const cwd = tempDir();
    const base = { cwd, base: "main", head: "fd/x", title: "t", body: "b" };
    expect(await az.create(base)).toBe(`${AZ_WEB}/pullrequest/3`);
    expect(await az.status({ cwd, url: `${AZ_WEB}/pullrequest/1` })).toEqual({
      state: "merged",
      checks: "failing",
    });
    expect(await az.status({ cwd, url: `${AZ_WEB}/pullrequest/2` })).toEqual({
      state: "open",
      checks: "pending",
    });
  });
});

describe("pr: erros e configuração", () => {
  test("projeto sem provedor ou card sem worktree não abre PR", async () => {
    const ctx = newBoard();
    cleanups.push(() => ctx.board.stop());
    const project = await ctx.board.addProject({ path: ctx.repo });
    const idle = ctx.board.createCard(project.id, { title: "Parado", description: "d" });
    const codes: string[] = [];
    codes.push(
      await ctx.board.createPr(idle.id).then(
        () => "abriu",
        (e) => e.code,
      ),
    );
    await ctx.board.startCard(idle.id);
    expect(await cardWhen(ctx.board, idle.id, (c) => c.column === "review")).not.toBeNull();
    codes.push(
      await ctx.board.createPr(idle.id).then(
        () => "abriu",
        (e) => e.code,
      ),
    );
    expect(codes).toEqual(["invalid_state", "invalid_state"]);
  });

  test("falha do CLI ao consultar o PR vira aviso no card", async () => {
    fake("gh", [
      { args: ["view", "url"], code: 1 },
      { args: ["pr", "create"], stdout: `${GH_URL}\n` },
      { args: ["view", "state,statusCheckRollup"], code: 4 },
    ]);
    const { board, card } = await cardWithWork("github");
    await board.createPr(card.id);
    const warned = await cardWhen(board, card.id, (c) => c.notice !== null);
    expect(warned?.notice ?? "").toContain("gh pr view falhou");
    expect(warned?.prState).toBe("open");
  });

  test("CLI ausente no PATH é erro claro", async () => {
    const saved = process.env.PATH;
    process.env.PATH = tempDir();
    try {
      const result = await new GithubCli().url({ cwd: tempDir(), head: "fd/x" }).then(
        () => "rodou",
        (e: { message: string }) => e.message,
      );
      expect(result).toBe("gh não encontrado no PATH");
    } finally {
      process.env.PATH = saved;
    }
  });

  test("intervalo de consulta: 60 s por padrão, board.prPollIntervalMs na config", async () => {
    const ctx = newBoard();
    cleanups.push(() => ctx.board.stop());
    expect(ctx.board.prPollIntervalMs).toBe(60_000);
    const file = join(tempDir(), "config.json");
    writeFileSync(
      file,
      JSON.stringify({ token: "t".repeat(32), board: { prPollIntervalMs: 500 } }),
    );
    expect(loadConfig(file).board.prPollIntervalMs).toBe(500);
    expect(Config.parse({}).board.prPollIntervalMs).toBeUndefined();
  });
});
