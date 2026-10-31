import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { AzureDevOpsCli } from "../src/board/pr.ts";
import { SecretScanner } from "../src/snippets/model.ts";
import { Traces } from "../src/watch/trace.ts";
import { git } from "./board-helpers.ts";
import { cleanups, fixture, work } from "./watch-helpers.ts";

setDefaultTimeout(30_000);

afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The fixture with a trail over it: the claude ids, the costs and the checkpoints are the test's. */
async function traced(options: Parameters<typeof fixture>[0] = {}) {
  const scanner = new SecretScanner();
  const f = await fixture({ ...options, board: { scanner, ...options.board } });
  const costs: Record<string, number> = {};
  const checkpoints: Record<string, number> = {};
  const hits: Array<{ claudeSessionId: string; title: string | null; cwd: string }> = [];
  const searched: string[] = [];
  const firstUser = (sessionId: string) =>
    f.store
      .eventsSince(sessionId, 0)
      .map((e) => e.event)
      .flatMap((e) => (e.type === "message.user" ? [e.text] : []))[0] ?? null;
  const traces = new Traces({
    scanner,
    db: f.store.db,
    board: f.board,
    fixer: f.fixer,
    claudeSessionOf: (id) => f.manager.get(id).claudeSessionId,
    describeSession: (id) => ({ name: f.manager.get(id).name, request: firstUser(id) }),
    sessionCosts: (ids) =>
      Object.fromEntries(
        ids.flatMap((id): Array<[string, number]> => {
          const cost = costs[id];
          return cost === undefined ? [] : [[id, cost]];
        }),
      ),
    cardCost: () => 1.5,
    checkpoints: (id) => checkpoints[id] ?? 0,
    search: (query) => {
      searched.push(query);
      return hits;
    },
  });
  return { ...f, traces, costs, checkpoints, hits, searched };
}

describe("rastro: from the card and its PR to sessions, cost, rounds and work item", () => {
  test("the trail lists the card's runs and the fixing sessions, with cost and checkpoints, the rounds and the work item", async () => {
    const f = await traced({ settings: { checks: [] } });
    f.store.db
      .query("UPDATE cards SET issue_ref = 'azure:acme/proj#12' WHERE id = ?")
      .run(f.card.id);
    await f.fixer.onTrigger(f.trigger({ comments: [work(0.6)] }));
    await f.fixer.idle();
    const trace = f.traces.trace(f.card.id);
    const [run, fix] = trace.sessions;
    expect(trace).toMatchObject({
      cardId: f.card.id,
      title: "Login",
      prUrl: PR_URL,
      workItem: "azure:acme/proj#12",
      costUsd: 1.5,
    });
    expect(trace.sessions.map((s) => s.kind)).toEqual(["run", "fix"]);
    expect(run?.name).toBe("Login");
    expect(trace.rounds).toEqual(f.fixer.rounds(f.card.id));
    expect(trace.rounds[0]?.sessionId).toBe(fix?.sessionId ?? "");
    // The cost and the checkpoints are those of each session's own Claude session.
    f.costs[fix?.claudeSessionId ?? ""] = 0.6;
    f.checkpoints[fix?.claudeSessionId ?? ""] = 3;
    const again = f.traces.trace(f.card.id).sessions;
    expect(again.map((s) => [s.kind, s.costUsd, s.checkpoints])).toEqual([
      ["run", null, 0],
      ["fix", 0.6, 3],
    ]);
  });

  test("a PR link opens its card; the link may come with a query, a fragment or a slash at the end", async () => {
    const f = await traced();
    for (const url of [PR_URL, `${PR_URL}/`, `${PR_URL}?_a=overview`, `${PR_URL}#discussion`]) {
      const found = f.traces.byUrl(url);
      expect(found.via).toBe("card");
      expect(found.trace?.cardId).toBe(f.card.id);
    }
    expect(f.searched).toEqual([]);
  });

  test("an old PR the card is gone for is found by the history index; one nobody knows is said so", async () => {
    const f = await traced();
    const old = "https://dev.azure.com/acme/proj/_git/repo/pullrequest/3";
    f.hits.push({ claudeSessionId: "c-1", title: "Corrige o login", cwd: "/work/repo" });
    expect(f.traces.byUrl(`${old}?x=1`)).toEqual({
      via: "history",
      trace: null,
      sessions: [{ claudeSessionId: "c-1", title: "Corrige o login", cwd: "/work/repo" }],
    });
    expect(f.searched).toEqual([old]);
    f.hits.length = 0;
    expect(f.traces.byUrl(old)).toEqual({ via: "none", trace: null, sessions: [] });
  });

  test("the generated description tells what the sessions did, the rounds and the work item", async () => {
    const f = await traced({ settings: { checks: [] } });
    f.store.db
      .query("UPDATE cards SET issue_ref = 'azure:acme/proj#12', description = ? WHERE id = ?")
      .run("Fazer o login funcionar", f.card.id);
    await f.fixer.onTrigger(f.trigger({ comments: [work(0, "troque o nome")] }));
    await f.fixer.idle();
    const { text, redacted } = f.traces.describe(f.card.id);
    expect(redacted).toBe(0);
    expect(text).toContain("Login");
    expect(text).toContain("Fazer o login funcionar");
    expect(text).toContain("Round 1 (pushed)");
    expect(text).toContain("AB#12");
  });

  test("the description is made from the sessions, and a line that carries a secret is taken out of it", async () => {
    const f = await traced({ settings: { checks: [] } });
    const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    f.store.db
      .query("UPDATE cards SET description = ? WHERE id = ?")
      .run(`Fazer o login\nusa o token ${token} do deploy\nsegunda linha`, f.card.id);
    await f.fixer.onTrigger(f.trigger({ comments: [work(0, `senha=hunter2hunter2`)] }));
    await f.fixer.idle();
    const { text, redacted } = f.traces.describe(f.card.id);
    expect(text).not.toContain(token);
    expect(text).not.toContain("hunter2");
    expect(text).toContain("Fazer o login");
    expect(text).toContain("segunda linha");
    expect(text).toContain("[line removed: it looked like a secret]");
    expect(redacted).toBeGreaterThan(0);
  });

  test("the PR opens with the text the person confirmed, and az takes it as one safe line", async () => {
    const az = installFakeCli("az", [
      { args: ["repos", "pr", "list"], stdout: "[]" },
      {
        args: ["repos", "pr", "create"],
        stdout: JSON.stringify({
          pullRequestId: 9,
          repository: { webUrl: "https://dev.azure.com/acme/proj/_git/repo" },
        }),
      },
    ]);
    cleanups.push(az.restore);
    const f = await traced({ board: { prProvider: () => new AzureDevOpsCli() } });
    f.store.db
      .query(
        "UPDATE cards SET description = 'do cartão', pr_url = NULL, pr_state = NULL WHERE id = ?",
      )
      .run(f.card.id);
    await f.board.createPr(f.card.id, {
      description: 'Faz <b>"o login"</b> & mais | 100%\nsegunda linha',
    });
    const create = az.calls().find((args) => args.includes("create")) ?? [];
    const description = create[create.indexOf("--description") + 1] ?? "";
    expect(description).toContain("login");
    expect(description).toContain("segunda linha");
    expect(description).not.toContain("do cartão");
    expect(description).not.toMatch(/[\r\n<>&|^"%]/);
  });

  test("a confirmed text with a secret is refused before anything is pushed or opened", async () => {
    const az = installFakeCli("az", []);
    cleanups.push(az.restore);
    const f = await traced({ board: { prProvider: () => new AzureDevOpsCli() } });
    f.store.db.query("UPDATE cards SET pr_url = NULL, pr_state = NULL WHERE id = ?").run(f.card.id);
    const before = git(f.remote, "rev-list", "--all", "--count");
    await expect(
      f.board.createPr(f.card.id, { description: "usa ghp_abcdefghijklmnopqrstuvwxyz0123456789" }),
    ).rejects.toThrow("secret");
    expect(az.calls()).toEqual([]);
    expect(git(f.remote, "rev-list", "--all", "--count")).toBe(before);
    expect(f.board.getCard(f.card.id).prUrl).toBeNull();
  });
});

const PR_URL = "https://dev.azure.com/acme/proj/_git/repo/pullrequest/9";
