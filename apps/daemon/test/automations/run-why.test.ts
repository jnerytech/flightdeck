import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { AutomationRun, type Issue } from "@flightdeck/protocol";
import { type AutomationEvent, causeOf } from "../../src/automations/domain/event.ts";
import { automationsRig, NET, UTC } from "../support/automations.ts";

setDefaultTimeout(NET * 2);

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const { setup } = automationsRig(cleanups);

/**
 * Issue #4185: a firing keeps a code and its values next to the English text, so the app can say the
 * cause and the detail in its own language; the text stays for the CLI and for rows written before.
 */
describe("what a firing records: the cause and the detail as a code with values", () => {
  test("each cause is a code with its values, and its text is the one the CLI always printed", () => {
    const issue = { ref: "#7", labels: ["bug", "auto"] } as unknown as Issue;
    const events: AutomationEvent[] = [
      { type: "cron", projectId: "p1", automationId: "a1", minute: UTC("2026-10-05T12:00:00Z") },
      {
        type: "pr_comment",
        cardId: "c1",
        commentId: "k1",
        author: "ana",
        text: "x",
        external: false,
      },
      { type: "ci_failed", cardId: "c1", key: "k", summary: "x" },
      { type: "issue_label", projectId: "p1", issue },
    ];
    expect(events.map(causeOf)).toEqual([
      {
        text: "schedule of 2026-10-05T12:00:00.000Z",
        why: { code: "cron", params: { at: "2026-10-05T12:00:00.000Z" } },
      },
      {
        text: "comment k1 by ana on the PR of card c1",
        why: { code: "pr_comment", params: { comment: "k1", author: "ana", card: "c1" } },
      },
      {
        text: "checks of the PR of card c1 failed",
        why: { code: "ci_failed", params: { card: "c1" } },
      },
      {
        text: "issue #7 with the label bug, auto",
        why: { code: "issue_label", params: { issue: "#7", labels: "bug, auto" } },
      },
    ]);
  });

  test("a schedule run stores its cause code and values, and keeps the English text", async () => {
    const { automations, on, time } = await setup();
    const a = on({ trigger: { type: "cron", expr: "* * * * *", tz: "UTC" } });
    time.now = UTC("2026-10-05T12:01:00Z");
    await automations.tick(time.now);
    expect(automations.runs(a.id)[0]).toMatchObject({
      cause: "schedule of 2026-10-05T12:01:00.000Z",
      causeCode: "cron",
      causeParams: { at: "2026-10-05T12:01:00.000Z" },
    });
  });

  test("a slot missed while the daemon was stopped says so as a code, with the slot and the reason", async () => {
    const { automations, make, on, time } = await setup();
    const a = on({ trigger: { type: "cron", expr: "30 9 * * *", tz: "UTC" } });
    time.now = UTC("2026-10-05T09:00:00Z");
    await automations.tick(time.now);
    automations.stop();
    time.now = UTC("2026-10-05T12:00:00Z");
    const boot = make();
    boot.start();
    boot.stop();
    expect(boot.runs(a.id).find((r) => r.status === "missed")).toMatchObject({
      cause: "missed schedule of 2026-10-05T09:30:00.000Z",
      causeCode: "missed",
      causeParams: { at: "2026-10-05T09:30:00.000Z" },
      detail: "the daemon was stopped",
      detailCode: "daemon_stopped",
      detailParams: {},
    });
  });

  test("a third party's comment is ignored with a code, and the second comment over the daily limit with the limit", async () => {
    const { automations, on, board, project } = await setup();
    const a = on({
      trigger: { type: "pr_comment" },
      action: { type: "send_to_card" },
      maxRunsPerDay: 1,
    });
    const bare = board.createCard(project.id, { title: "Sem sessão", description: "x" });
    const comment = (id: string, external: boolean) => ({
      type: "pr_comment" as const,
      cardId: bare.id,
      commentId: id,
      author: "ana",
      text: "oi",
      external,
    });
    await automations.fire(comment("k1", true));
    await automations.fire(comment("k2", false));
    await automations.fire(comment("k3", false));
    const byCause = (id: string) =>
      automations.runs(a.id).find((r) => r.causeParams?.comment === id);
    expect([byCause("k1"), byCause("k3")]).toMatchObject([
      {
        status: "ignored",
        detail: "external author: the automation does not act on third-party content",
        detailCode: "external_author",
        detailParams: {},
      },
      {
        status: "limited",
        detail: "limit of 1 runs per day",
        detailCode: "daily_limit",
        detailParams: { max: 1 },
      },
    ]);
  });

  test("a run recorded before the codes existed reads as it was stored, with no code", async () => {
    const { automations, on, store } = await setup();
    const a = on({ trigger: { type: "pr_comment" }, action: { type: "send_to_card" } });
    store.db
      .query(
        "INSERT INTO automation_runs (id, automation_id, fired_at, cause, status, detail) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("old1", a.id, "2026-10-01T10:00:00.000Z", "schedule of old", "ok", "card c1");
    expect(automations.runs(a.id)[0]).toMatchObject({
      cause: "schedule of old",
      detail: "card c1",
      causeCode: null,
      causeParams: null,
      detailCode: null,
      detailParams: null,
    });
  });

  test("the protocol still reads a run with no codes, and keeps the codes of one that has them", () => {
    const base = {
      id: "r1",
      automationId: "a1",
      firedAt: "2026-10-01T10:00:00.000Z",
      cause: "schedule of x",
      status: "ok",
      detail: null,
    };
    expect([
      AutomationRun.safeParse(base).success,
      AutomationRun.parse({ ...base, causeCode: "cron", causeParams: { at: "x" } }).causeCode,
    ]).toEqual([true, "cron"]);
  });
});
