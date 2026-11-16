import { afterEach, describe, expect, test } from "bun:test";
import type { EventEnvelope } from "@flightdeck/protocol";
import { translator } from "../../src/i18n/index.ts";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { applyEnvelope, emptySession } = await import(
  "../../src/features/sessions/domain/session-state.ts"
);
const { inputSummary } = await import("../../src/features/sessions/domain/tool-input.ts");
const { SessionView } = await import("../../src/features/sessions/session-view.tsx");
const { ApprovalCard } = await import("../../src/features/permissions/approval-card.tsx");

afterEach(cleanup);

const QUESTIONS = {
  questions: [
    {
      question: "Em que o Alivio v1 deve rodar?",
      header: "Plataforma",
      multiSelect: false,
      options: [{ label: "Web", description: "Browser" }],
    },
    {
      question: "Onde ficam os dados?",
      header: "Dados",
      multiSelect: false,
      options: [{ label: "Local", description: "On disk" }],
    },
  ],
};

describe("conversation-rows: a tool row says what it does", () => {
  test("an AskUserQuestion row shows the question, never the input's JSON", () => {
    const line = inputSummary(QUESTIONS);
    expect(line).toContain("Em que o Alivio v1 deve rodar?");
    expect(line).not.toContain("{");
    expect(line).not.toContain("questions:");
  });
});

const turn = (seq: number, costUsd: number, isError: boolean, subtype: string): EventEnvelope =>
  ({
    type: "event",
    sessionId: "s",
    seq,
    ts: "2026-11-16T10:00:00.000Z",
    event: { type: "turn.result", subtype, isError, durationMs: 9500, costUsd },
  }) as EventEnvelope;

const actions = {
  send: async () => {},
  interrupt: async () => {},
  close: async () => {},
  resume: async () => {},
  respond: async () => {},
};
const rowsOf = (state: ReturnType<typeof emptySession>) => {
  render(<SessionView title="s" session={state} actions={actions} />);
  return Array.from(document.querySelectorAll("[data-slot='turn-result']")).map(
    (row) => row.textContent ?? "",
  );
};

describe("conversation-rows: a turn's end says why and what it cost", () => {
  // The CLI reports the session's running total on every result: 0.4841, 0.4841, 0.5267 is
  // one turn that cost 0.4841, one that cost nothing and one that cost 0.0426.
  const total = [
    turn(1, 0.4841, true, "error_max_turns"),
    turn(2, 0.4841, true, "error_during_execution"),
    turn(3, 0.5267, false, "success"),
  ].reduce(applyEnvelope, emptySession());

  test("the cost shown is the turn's own, not the session's running total", () => {
    const rows = rowsOf(total);
    expect(rows).toHaveLength(3);
    expect(rows[0] ?? "").toContain("0,4841");
    expect(rows[1] ?? "").not.toContain("0,48");
    expect(rows[2] ?? "").toContain("0,0426");
    expect(rows[2] ?? "").not.toContain("0,5267");
  });

  test("a result with no cost leaves the total it follows as it was, and a smaller total subtracts nothing", () => {
    const noCost = {
      ...turn(2, 0, false, "success"),
      event: { type: "turn.result", subtype: "success", isError: false, durationMs: 1000 },
    } as EventEnvelope;
    const state = [turn(1, 0.4, false, "success"), noCost, turn(3, 0.5, false, "success")].reduce(
      applyEnvelope,
      emptySession(),
    );
    const rows = rowsOf(state);
    expect(rows[2] ?? "").toContain("0,1000");
    const lower = [turn(1, 0.4, false, "success"), turn(2, 0.1, false, "success")].reduce(
      applyEnvelope,
      emptySession(),
    );
    cleanup();
    expect(rowsOf(lower)[1] ?? "").not.toContain("US$");
  });

  test("a failed turn names its reason", () => {
    const rows = rowsOf(total);
    expect(rows[0] ?? "").toContain("limite de turnos atingido");
    expect(rows[1] ?? "").toContain("erro durante a execução");
  });

  test("a reason the app does not know is a plain sentence, never the host's code", () => {
    const rows = rowsOf(applyEnvelope(emptySession(), turn(1, 0.1, true, "error_strange")));
    expect(rows[0] ?? "").toContain("parou com erro");
    expect(rows[0] ?? "").not.toContain("error_strange");
  });
});

describe("conversation-rows: a question nobody answered says so once", () => {
  const en = translator("en");
  const tree = (decision: "deny" | "expired" | "allow", answers?: Record<string, string>) => (
    <ApprovalCard
      request={{
        requestId: "q1",
        toolName: "AskUserQuestion",
        input: QUESTIONS,
        cwd: null,
        createdAt: null,
        risk: "medium",
      }}
      t={en}
      nowMs={0}
      resolution={{ decision, ...(answers ? { answers } : {}) }}
      onRespond={() => undefined}
    />
  );
  const summary = () => document.querySelector("details[data-answered] summary")?.textContent;

  test("the outcome follows the questions once, not after each one", () => {
    render(tree("expired"));
    expect(summary()).toBe("Plataforma · Dados: expired");
    expect(screen.queryByText("Em que o Alivio v1 deve rodar?")).not.toBeNull();
  });

  test("an answered question still shows each real answer", () => {
    render(
      tree("allow", { "Em que o Alivio v1 deve rodar?": "Web", "Onde ficam os dados?": "Local" }),
    );
    expect(summary()).toBe("Plataforma: Web · Dados: Local");
  });
});
