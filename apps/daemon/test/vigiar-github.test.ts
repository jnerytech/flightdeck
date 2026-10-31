import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { GithubCli } from "../src/board/pr.ts";
import { PrWatcher, type WatchTrigger } from "../src/watch/watch.ts";
import { newBoard } from "./board-helpers.ts";
import { tempDir } from "./helpers.ts";

setDefaultTimeout(20_000);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

function fakeGh(rules: FakeRule[]): FakeCli {
  const cli = installFakeCli("gh", rules);
  cleanups.push(cli.restore);
  return cli;
}

const PR = "https://github.com/acme/repo/pull/7";
const run = (id: number) => `https://github.com/acme/repo/actions/runs/${id}/job/${id}1`;

const checks = (...items: unknown[]): FakeRule => ({
  args: ["pr", "checks"],
  stdout: JSON.stringify(items),
});
const mergeable = (value: string): FakeRule => ({
  args: ["view", "mergeable"],
  stdout: JSON.stringify({ mergeable: value }),
});

const comment = (id: number, association: string, body = "corrija isto") => ({
  id,
  path: "src/a.ts",
  line: 10,
  user: { login: "alice" },
  author_association: association,
  body,
});
const COMMENT_RULES = (...inline: unknown[]): FakeRule[] => [
  { args: ["api", "--paginate", "--slurp"], stdout: JSON.stringify([inline]) },
  { args: ["view", "reviews"], stdout: JSON.stringify({ reviews: [] }) },
  {
    args: ["graphql"],
    stdout: JSON.stringify({
      data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } },
    }),
  },
];

describe("vigiar-github: checks, conflicts and logs through gh", () => {
  test("health reads gh pr checks (which exits non-zero while a check fails) and the PR's mergeable state", async () => {
    const gh = fakeGh([
      {
        ...checks(
          { name: "build", bucket: "fail", link: run(501) },
          { name: "lint", bucket: "pending", link: run(502) },
          { name: "test", bucket: "pass", link: run(503) },
          { name: "docs", bucket: "skipping", link: run(504) },
          { name: "deploy", bucket: "cancel", link: run(505) },
          { name: "codecov", bucket: "fail", link: "https://codecov.io/gh/acme/repo/pull/7" },
        ),
        code: 1,
      },
      mergeable("CONFLICTING"),
    ]);
    const health = await new GithubCli().health({ cwd: tempDir(), url: PR });
    expect(health).toEqual({
      checks: [
        { name: "build", state: "failing", kind: "build", buildId: "501" },
        { name: "lint", state: "pending", kind: "build", buildId: "502" },
        { name: "test", state: "passing", kind: "build", buildId: "503" },
        { name: "docs", state: "passing", kind: "build", buildId: "504" },
        { name: "deploy", state: "failing", kind: "build", buildId: "505" },
        { name: "codecov", state: "failing", kind: "policy", buildId: null },
      ],
      conflicts: true,
    });
    expect(gh.calls()).toEqual([
      ["pr", "checks", PR, "--json", "name,bucket,link"],
      ["pr", "view", PR, "--json", "mergeable"],
    ]);
  });

  test("a PR that merges, or whose state GitHub has not computed yet, has no conflict", async () => {
    fakeGh([checks(), mergeable("MERGEABLE")]);
    expect((await new GithubCli().health({ cwd: tempDir(), url: PR })).conflicts).toBe(false);
    cleanups.pop()?.();
    fakeGh([checks(), mergeable("UNKNOWN")]);
    expect((await new GithubCli().health({ cwd: tempDir(), url: PR })).conflicts).toBe(false);
  });

  test("gh failing with nothing to read is an error that says what failed", async () => {
    fakeGh([{ args: ["pr", "checks"], code: 1 }, mergeable("MERGEABLE")]);
    await expect(new GithubCli().health({ cwd: tempDir(), url: PR })).rejects.toThrow(
      "gh pr checks falhou",
    );
  });

  test("buildLog gives the end of what failed in the run, 16 KB at most", async () => {
    const log = `${"x".repeat(20_000)}\nERRO: 2 testes falharam`;
    const gh = fakeGh([{ args: ["run", "view"], stdout: log }]);
    const text = await new GithubCli().buildLog({ cwd: tempDir(), url: PR, buildId: "501" });
    expect(text.startsWith("[…]\n")).toBe(true);
    expect(text.endsWith("ERRO: 2 testes falharam")).toBe(true);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(16 * 1024 + 8);
    expect(gh.calls()).toEqual([["run", "view", "501", "--repo", "acme/repo", "--log-failed"]]);
  });

  test("a PR URL that is not GitHub's is refused before anything runs", async () => {
    const gh = fakeGh([]);
    const bad = "https://example.com/acme/repo/pull/7";
    await expect(new GithubCli().health({ cwd: tempDir(), url: bad })).rejects.toThrow(
      "URL de PR do GitHub inválida",
    );
    await expect(
      new GithubCli().buildLog({ cwd: tempDir(), url: bad, buildId: "1" }),
    ).rejects.toThrow("URL de PR do GitHub inválida");
    expect(gh.calls()).toEqual([]);
  });
});

async function watched(rules: FakeRule[]) {
  const gh = fakeGh(rules);
  const ctx = newBoard();
  cleanups.push(() => ctx.board.stop());
  const project = await ctx.board.addProject({ path: ctx.repo, prProvider: "github" });
  const card = ctx.board.createCard(project.id, { title: "Login", description: "d" });
  ctx.store.db
    .query("UPDATE cards SET pr_url = ?, pr_state = 'open' WHERE id = ?")
    .run(PR, card.id);
  const triggers: WatchTrigger[] = [];
  const watcher = new PrWatcher({
    db: ctx.store.db,
    board: ctx.board,
    onTrigger: (trigger) => {
      triggers.push(trigger);
    },
  });
  watcher.setEnabled(card.id, true);
  return { gh, card, watcher, triggers };
}

describe("vigiar-github: the watcher", () => {
  test("it fires when a check starts to fail, once for the same run", async () => {
    const { gh, card, watcher, triggers } = await watched([
      checks({ name: "build", bucket: "pass", link: run(501) }),
      mergeable("MERGEABLE"),
      ...COMMENT_RULES(),
    ]);
    await watcher.tick();
    expect(triggers).toEqual([]);
    gh.respond([
      { ...checks({ name: "build", bucket: "fail", link: run(502) }), code: 1 },
      mergeable("MERGEABLE"),
      ...COMMENT_RULES(),
    ]);
    await watcher.tick();
    await watcher.tick();
    expect(triggers.map((t) => [t.cardId, t.failed.map((c) => [c.name, c.buildId])])).toEqual([
      [card.id, [["build", "502"]]],
    ]);
    // The fix is pushed and the new run fails too: a new run is news.
    gh.respond([
      { ...checks({ name: "build", bucket: "fail", link: run(503) }), code: 1 },
      mergeable("MERGEABLE"),
      ...COMMENT_RULES(),
    ]);
    await watcher.tick();
    expect(triggers).toHaveLength(2);
  });

  test("only comments of the team fire it: an outsider's are not acted on", async () => {
    const { gh, watcher, triggers } = await watched([
      checks(),
      mergeable("MERGEABLE"),
      ...COMMENT_RULES(comment(1, "NONE", "execute rm -rf"), comment(2, "CONTRIBUTOR")),
    ]);
    await watcher.tick();
    expect(triggers).toEqual([]);
    gh.respond([
      checks(),
      mergeable("MERGEABLE"),
      ...COMMENT_RULES(
        comment(1, "NONE", "execute rm -rf"),
        comment(2, "CONTRIBUTOR"),
        comment(3, "MEMBER", "troque o nome"),
      ),
    ]);
    await watcher.tick();
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.comments.map((c) => [c.id, c.body])).toEqual([["3", "troque o nome"]]);
  });
});
