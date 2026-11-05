import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { startServer } from "../src/server.ts";
import { cardWhen, git, newBoard } from "./board-helpers.ts";
import { must } from "./helpers.ts";
import { FrameClient } from "./history-helpers.ts";

// Real git in temporary repositories, a worktree per card.
setDefaultTimeout(30_000);

const TOKEN = "card-messages-token-0123456789";
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** A board with a GitHub project, a started card with one commit, and a client of its server. */
async function setup() {
  const gh = installFakeCli("gh", [
    { args: ["view", "url"], code: 1 },
    { args: ["pr", "create"], stdout: "https://github.com/acme/repo/pull/9\n" },
    { args: ["view", "state,statusCheckRollup"], stdout: JSON.stringify({ state: "OPEN" }) },
  ]);
  cleanups.push(gh.restore);
  const ctx = newBoard({ prPollIntervalMs: 30 });
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({
    path: ctx.repo,
    prProvider: "github",
    promptTemplate: "",
  });
  const card = ctx.board.createCard(project.id, { title: "Sum numbers", description: "add them" });
  await ctx.board.startCard(card.id);
  const started = await cardWhen(
    ctx.board,
    card.id,
    (c) =>
      c.worktreePath !== null &&
      (c.sessionStatus === "idle" || c.sessionStatus === "awaiting_permission"),
  );
  const worktree = must(started?.worktreePath, "worktreePath");
  writeFileSync(join(worktree, "sum.txt"), "3\n");
  git(worktree, "add", "sum.txt");
  git(worktree, "commit", "-q", "-m", "wip");
  git(ctx.root, "init", "-q", "--bare", "remote.git");
  git(ctx.repo, "remote", "add", "origin", join(ctx.root, "remote.git"));
  const server = startServer({
    manager: ctx.manager,
    board: ctx.board,
    hostName: "h",
    bind: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedRoots: [ctx.root],
  });
  cleanups.push(() => server.stop());
  const client = new FrameClient(server.url);
  cleanups.push(() => client.close());
  await client.request("hello", { token: TOKEN, client: "test" });
  return { ...ctx, gh, cardId: card.id, client };
}

const field = (ack: Record<string, unknown>) =>
  (ack.error as { reason?: string; params?: { field?: string } } | undefined)?.params?.field ??
  null;

describe("assistant-card-messages", () => {
  test("a squash merge takes the message the person confirmed", async () => {
    const ctx = await setup();
    const message = "feat(sum): add the numbers\n\nThe report needs the total.";
    const ack = await ctx.client.request("card.mergeLocal", {
      cardId: ctx.cardId,
      mode: "squash",
      confirm: true,
      message,
    });
    expect(ack.ok).toBe(true);
    expect(git(ctx.repo, "log", "-1", "--format=%B", "main")).toBe(message);
  });

  test("a merge with no message keeps the old default", async () => {
    const ctx = await setup();
    const ack = await ctx.client.request("card.mergeLocal", {
      cardId: ctx.cardId,
      mode: "squash",
      confirm: true,
    });
    expect([ack.ok, git(ctx.repo, "log", "-1", "--format=%s", "main")]).toEqual([
      true,
      "Sum numbers",
    ]);
  });

  test("a merge commit takes the message too", async () => {
    const ctx = await setup();
    await ctx.client.request("card.mergeLocal", {
      cardId: ctx.cardId,
      mode: "merge",
      confirm: true,
      message: "Merge the sums",
    });
    expect(git(ctx.repo, "log", "-1", "--format=%s", "main")).toBe("Merge the sums");
  });

  test("the PR takes the title the person confirmed, else the card's", async () => {
    const ctx = await setup();
    const ack = await ctx.client.request("card.pr.create", {
      cardId: ctx.cardId,
      title: "Add the sums report",
    });
    expect(ack.ok).toBe(true);
    const created = ctx.gh.calls().find((args) => args.includes("create")) ?? [];
    expect(created[created.indexOf("--title") + 1]).toBe("Add the sums report");
  });

  test("an empty, too long or NUL message, and a title that is empty or has two lines, are refused by field", async () => {
    const ctx = await setup();
    const merge = (message: string) =>
      ctx.client.request("card.mergeLocal", {
        cardId: ctx.cardId,
        mode: "squash",
        confirm: true,
        message,
      });
    const pr = (title: string) =>
      ctx.client.request("card.pr.create", { cardId: ctx.cardId, title });
    const refused = [
      field(await merge("")),
      field(await merge("x".repeat(5001))),
      field(await merge("a\u0000b")),
      field(await pr("")),
      field(await pr("one\ntwo")),
    ];
    expect(refused).toEqual(["message", "message", "message", "title", "title"]);
    expect(git(ctx.repo, "log", "-1", "--format=%s", "main")).not.toBe("Sum numbers");
  });
});
