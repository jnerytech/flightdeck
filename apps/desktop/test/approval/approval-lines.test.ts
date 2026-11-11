import { describe, expect, test } from "bun:test";
import {
  autoLine,
  resolutionLine,
  savedAnswers,
} from "../../src/components/approval/approval-lines.ts";
import { translator } from "../../src/i18n/index.ts";

const t = translator("en");

describe("approval-lines: the answers a request already carries", () => {
  test("an answered request gives its answers back", () => {
    expect(savedAnswers({ answers: { color: "blue" }, questions: [] })).toEqual({ color: "blue" });
  });

  test("a request that was not answered, or whose answers are no object, gives none", () => {
    expect(savedAnswers({})).toBeNull();
    expect(savedAnswers({ answers: null })).toBeNull();
    expect(savedAnswers({ answers: "blue" })).toBeNull();
  });
});

describe("approval-lines: who approved a request on its own, and why", () => {
  test("a rule names itself and gives its reason", () => {
    expect(autoLine({ by: "rule", reason: "read-only", model: null }, t)).toBe(
      t("approval.autoApproved", { by: t("approval.autoBy.rule"), reason: "read-only" }),
    );
  });

  test("the AI names its model when it has one, and only itself when it has not", () => {
    expect(autoLine({ by: "ai", reason: "safe", model: "haiku" }, t)).toBe(
      t("approval.autoApproved", {
        by: t("approval.autoBy.aiModel", { model: "haiku" }),
        reason: "safe",
      }),
    );
    expect(autoLine({ by: "ai", reason: "safe", model: null }, t)).toBe(
      t("approval.autoApproved", { by: t("approval.autoBy.ai"), reason: "safe" }),
    );
  });

  test("says it in plain words", () => {
    expect(autoLine({ by: "rule", reason: "read-only", model: null }, t)).toBe(
      "Approved automatically (rule): read-only",
    );
    expect(autoLine({ by: "ai", reason: "safe", model: "haiku" }, t)).toBe(
      "Approved automatically (AI, haiku): safe",
    );
    expect(autoLine({ by: "ai", reason: "safe", model: null }, t)).toBe(
      "Approved automatically (AI): safe",
    );
  });

  test("a rule's model is not named even if one is set", () => {
    expect(autoLine({ by: "rule", reason: "r", model: "haiku" }, t)).toBe(
      t("approval.autoApproved", { by: t("approval.autoBy.rule"), reason: "r" }),
    );
  });
});

describe("approval-lines: what the card says once the request is settled", () => {
  test("a denial with a message gives the message", () => {
    expect(resolutionLine({ decision: "deny", message: "not this folder" }, t)).toBe(
      t("approval.deniedWith", { message: "not this folder" }),
    );
  });

  test("a denial with no message, and the other decisions, say the decision", () => {
    expect(resolutionLine({ decision: "deny" }, t)).toBe(t("approval.resolved.deny"));
    expect(resolutionLine({ decision: "deny", message: "" }, t)).toBe(t("approval.resolved.deny"));
    expect(resolutionLine({ decision: "allow" }, t)).toBe(t("approval.resolved.allow"));
    expect(resolutionLine({ decision: "cancelled" }, t)).toBe(t("approval.resolved.cancelled"));
    expect(resolutionLine({ decision: "expired" }, t)).toBe(t("approval.resolved.expired"));
  });

  test("an automatic approval says who decided, not just the decision", () => {
    const auto = { by: "ai" as const, reason: "safe", model: "haiku" };
    expect(resolutionLine({ decision: "allow", auto }, t)).toBe(autoLine(auto, t));
  });

  test("a denial's message wins over an automatic approval attached to it", () => {
    const auto = { by: "rule" as const, reason: "r", model: null };
    expect(resolutionLine({ decision: "deny", message: "no", auto }, t)).toBe(
      t("approval.deniedWith", { message: "no" }),
    );
  });
});
