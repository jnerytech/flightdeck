import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { FlightdeckError } from "../src/errors.ts";
import { Issues } from "../src/issues/issues.ts";
import { git, newBoard } from "./board-helpers.ts";

// Real git and a fake CLI (a Bun process each): more than the default 5 s.
setDefaultTimeout(20_000);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The code, reason and params of the refusal a call ends in. */
async function refused(call: () => unknown) {
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(FlightdeckError);
    const { code, reason, params } = error as FlightdeckError;
    return { code, reason, params };
  }
  throw new Error("it did not refuse");
}

/** A project with an `origin` (or none) and the issue integration of `provider` (or none). */
async function setup(remote: string | null, provider: "github" | "azure" | null) {
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  if (remote) git(ctx.repo, "remote", "add", "origin", remote);
  const project = await ctx.board.addProject({
    path: ctx.repo,
    promptTemplate: "",
    ...(provider ? { issues: { commentOnPr: false, provider } } : {}),
  });
  return { ...ctx, project, service: new Issues({ board: ctx.board }) };
}

const GH_REMOTE = "git@github.com:Acme/App.git";
const issue = (n: number) => ({
  number: n,
  title: `Issue ${n}`,
  body: "body",
  url: `https://github.com/Acme/App/issues/${n}`,
  author: { login: "ana" },
  labels: [],
  createdAt: "2026-10-01T10:00:00Z",
  authorAssociation: "MEMBER",
});

describe("recusas-issues: the project's integration", () => {
  test("no integration, no origin, and a remote that is not the provider's", async () => {
    const none = await setup(GH_REMOTE, null);
    expect(await refused(() => none.service.list(none.project.id))).toEqual({
      code: "invalid_state",
      reason: "project_no_issues",
      params: undefined,
    });
    const bare = await setup(null, "github");
    expect(await refused(() => bare.service.list(bare.project.id))).toEqual({
      code: "invalid_state",
      reason: "project_no_origin",
      params: undefined,
    });
    const gitlab = await setup("https://gitlab.com/a/b.git", "github");
    expect(await refused(() => gitlab.service.list(gitlab.project.id))).toEqual({
      code: "invalid_state",
      reason: "remote_not_github",
      params: { url: "https://gitlab.com/a/b.git" },
    });
    const azure = await setup(GH_REMOTE, "azure");
    expect(await refused(() => azure.service.list(azure.project.id))).toEqual({
      code: "invalid_state",
      reason: "remote_not_azure",
      params: { url: GH_REMOTE },
    });
  });

  test("an id that would read as an option never reaches the CLI", async () => {
    const { service, project } = await setup(GH_REMOTE, "github");
    expect(await refused(() => service.get(project.id, "-R"))).toEqual({
      code: "invalid_state",
      reason: "issue_id_invalid",
      params: { id: "-R" },
    });
  });
});

describe("recusas-issues: making a card from an issue", () => {
  test("an issue of another provider, of another repository, and one that already has a card", async () => {
    const gh = installFakeCli("gh", [
      { args: ["api", "user"], stdout: "me\n" },
      { args: ["issue", "view", "7"], stdout: JSON.stringify(issue(7)) },
    ]);
    cleanups.push(gh.restore);
    const { service, project } = await setup(GH_REMOTE, "github");
    expect(await refused(() => service.createCard(project.id, "azure:acme/proj#7"))).toEqual({
      code: "invalid_state",
      reason: "issue_not_this_project",
      params: { issue: "azure:acme/proj#7", provider: "github" },
    });
    expect(await refused(() => service.createCard(project.id, "github:Other/Repo#7"))).toEqual({
      code: "invalid_state",
      reason: "issue_other_repo",
      params: { issue: "github:Other/Repo#7" },
    });
    const card = await service.createCard(project.id, "github:Acme/App#7");
    expect(await refused(() => service.createCard(project.id, "github:Acme/App#7"))).toEqual({
      code: "invalid_state",
      reason: "issue_has_card",
      params: { ref: "github:Acme/App#7", card: card.id },
    });
  });
});
