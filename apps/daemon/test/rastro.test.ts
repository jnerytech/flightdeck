import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { AzureDevOpsCli } from "../src/board/pr.ts";
import { Traces } from "../src/watch/trace.ts";
import { cleanups, fixture, work } from "./watch-helpers.ts";

setDefaultTimeout(30_000);

afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** The fixture with a trail over it: the claude ids, the costs and the checkpoints are the test's. */
async function traced(options: Parameters<typeof fixture>[0] = {}) {
  let traces: Traces | null = null;
  const f = await fixture({
    ...options,
    board: { prDescription: (id) => traces?.describe(id) ?? "", ...options.board },
  });
  const costs: Record<string, number> = {};
  const checkpoints: Record<string, number> = {};
  const hits: Array<{ claudeSessionId: string; title: string | null; cwd: string }> = [];
  const searched: string[] = [];
  const firstUser = (sessionId: string) =>
    f.store
      .eventsSince(sessionId, 0)
      .map((e) => e.event)
      .flatMap((e) => (e.type === "message.user" ? [e.text] : []))[0] ?? null;
  traces = new Traces({
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
    f.store.db.query("UPDATE cards SET issue_ref = 'AB#12' WHERE id = ?").run(f.card.id);
    await f.fixer.onTrigger(f.trigger({ comments: [work(0.6)] }));
    await f.fixer.idle();
    const trace = f.traces.trace(f.card.id);
    const [run, fix] = trace.sessions;
    expect(trace).toMatchObject({
      cardId: f.card.id,
      title: "Login",
      prUrl: PR_URL,
      workItem: "AB#12",
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
      .query("UPDATE cards SET issue_ref = 'AB#12', description = ? WHERE id = ?")
      .run("Fazer o login funcionar", f.card.id);
    await f.fixer.onTrigger(f.trigger({ comments: [work(0, "troque o nome")] }));
    await f.fixer.idle();
    const text = f.traces.describe(f.card.id);
    expect(text).toContain("Login");
    expect(text).toContain("Fazer o login funcionar");
    expect(text).toContain("Round 1 (pushed)");
    expect(text).toContain("AB#12");
  });

  test("with generate, the PR opens with the generated description, and az takes it as one safe line", async () => {
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
      .query("UPDATE cards SET description = ?, pr_url = NULL, pr_state = NULL WHERE id = ?")
      .run('Faz <b>"o login"</b> & mais | 100%\nsegunda linha', f.card.id);
    await f.board.createPr(f.card.id, { generate: true });
    const create = az.calls().find((args) => args.includes("create")) ?? [];
    const description = create[create.indexOf("--description") + 1] ?? "";
    expect(description).toContain("login");
    expect(description).toContain("Login");
    expect(description).toContain("segunda linha");
    expect(description).not.toMatch(/[\r\n<>&|^"%]/);
    // Without it, the PR keeps the card's own description.
    f.store.db.query("UPDATE cards SET pr_url = NULL, pr_state = NULL WHERE id = ?").run(f.card.id);
    az.respond([
      { args: ["repos", "pr", "list"], stdout: "[]" },
      {
        args: ["repos", "pr", "create"],
        stdout: JSON.stringify({
          pullRequestId: 10,
          repository: { webUrl: "https://dev.azure.com/acme/proj/_git/repo" },
        }),
      },
    ]);
    await f.board.createPr(f.card.id);
    const plain =
      az
        .calls()
        .filter((args) => args.includes("create"))
        .at(-1) ?? [];
    expect(plain[plain.indexOf("--description") + 1]).not.toContain("Round");
    expect(plain[plain.indexOf("--description") + 1]).toContain("segunda linha");
  });
});

const PR_URL = "https://dev.azure.com/acme/proj/_git/repo/pullrequest/9";
