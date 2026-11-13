import { describe, expect, test } from "bun:test";
import type { HistoryMessage } from "@flightdeck/protocol";
import { awaitingApproval } from "../../src/features/sessions/domain/awaiting-approval.ts";

const message = (role: "user" | "assistant", text: string, uuid = text): HistoryMessage => ({
  uuid,
  ts: null,
  role,
  kind: "message",
  text,
});

describe("awaiting-approval: what a stored conversation waits for (#1705)", () => {
  test("an assistant turn that ends in ExitPlanMode waits for the plan to be approved", () => {
    const tail = [
      message("user", "plan it"),
      message("assistant", "Here it is.\n[tool ExitPlanMode] plan"),
    ];
    expect(awaitingApproval(tail)).toBe("plan");
  });

  test("an assistant turn that ends in AskUserQuestion waits for an answer", () => {
    expect(awaitingApproval([message("assistant", "[tool AskUserQuestion] which one?")])).toBe(
      "question",
    );
  });

  test("anything after the call, from either side, means it was answered", () => {
    const call = message("assistant", "[tool ExitPlanMode] plan");
    expect(awaitingApproval([call, message("user", "no, change it")])).toBeNull();
    expect(awaitingApproval([call, message("assistant", "Done.")])).toBeNull();
  });

  test("another tool at the tail, a call that is not last in its turn, or an empty tail wait for nothing", () => {
    expect(awaitingApproval([message("assistant", "[tool Bash] ls")])).toBeNull();
    expect(
      awaitingApproval([message("assistant", "[tool ExitPlanMode] plan\n[tool Bash] ls")]),
    ).toBeNull();
    expect(awaitingApproval([])).toBeNull();
  });

  test("the older [ferramenta Name] line counts like [tool Name]", () => {
    expect(awaitingApproval([message("assistant", "[ferramenta ExitPlanMode] plano")])).toBe(
      "plan",
    );
  });
});
