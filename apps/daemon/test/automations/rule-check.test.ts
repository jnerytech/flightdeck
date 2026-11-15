import { describe, expect, test } from "bun:test";
import type { Automation } from "@flightdeck/protocol";
import type { AutomationEvent } from "../../src/automations/domain/event.ts";
import { refusal, ruleProblem } from "../../src/automations/domain/rule-check.ts";

type Trigger = Automation["trigger"];
type Action = Automation["action"];

const CRON: Trigger = { type: "cron", expr: "0 9 * * *", tz: "UTC" };
const WORKFLOW: Action = { type: "start_workflow", workflow: "fix" };

describe("rule-check: what an automation could never do", () => {
  test("a rule that fits its trigger is accepted", () => {
    expect([
      ruleProblem(CRON, WORKFLOW),
      ruleProblem({ type: "ci_failed" }, { type: "send_to_card" }),
      ruleProblem({ type: "issue_label", label: "bug" }, { type: "create_card" }),
    ]).toEqual([null, null, null]);
  });

  test("a cron that does not parse or a zone that does not exist says why", () => {
    expect([
      ruleProblem({ type: "cron", expr: "nope", tz: "UTC" }, WORKFLOW)?.reason,
      ruleProblem({ type: "cron", expr: "0 9 * * *", tz: "Mars/Base" }, WORKFLOW),
    ]).toEqual([
      expect.any(String),
      {
        message: "unknown time zone: Mars/Base",
        reason: "automation_tz_unknown",
        params: { tz: "Mars/Base" },
      },
    ]);
  });

  test("an action that needs a card or an issue refuses a trigger that has none", () => {
    expect([
      ruleProblem(CRON, { type: "send_to_card" })?.reason,
      ruleProblem(CRON, { type: "create_card" })?.reason,
    ]).toEqual(["automation_send_needs_card", "automation_create_needs_label"]);
  });
});

const COMMENT = (external: boolean): AutomationEvent => ({
  type: "pr_comment",
  cardId: "c1",
  commentId: "k1",
  author: "someone",
  text: "hi",
  external,
});
const RULE = { allowExternalAuthors: false, maxRunsPerDay: 3 };

describe("rule-check: what an automation leaves alone", () => {
  test("a third party's content is ignored unless the automation allows it, and the count is never asked", () => {
    let asked = 0;
    const today = () => ++asked;
    expect([
      refusal(RULE, COMMENT(true), today)?.status,
      refusal({ ...RULE, allowExternalAuthors: true }, COMMENT(true), () => 0),
      asked,
    ]).toEqual(["ignored", null, 0]);
  });

  test("the day is limited once as many runs counted as the limit", () => {
    expect([
      refusal(RULE, COMMENT(false), () => 2),
      refusal(RULE, COMMENT(false), () => 3),
    ]).toEqual([null, { status: "limited", detail: "limit of 3 runs per day" }]);
  });
});
