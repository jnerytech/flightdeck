import { afterEach, describe, expect, test } from "bun:test";
import { translator } from "../../src/i18n/index.ts";
import { liveScreen, registerDom } from "../dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ApprovalCard } = await import("../../src/features/permissions/approval-card.tsx");

afterEach(cleanup);

const NOW = Date.parse("2026-11-02T12:00:00.000Z");

const QUESTIONS = {
  questions: [
    {
      question: "Which database?",
      header: "Database",
      multiSelect: false,
      options: [{ label: "SQLite" }, { label: "Postgres" }],
    },
    {
      question: "Which extras?",
      header: "Extras",
      multiSelect: true,
      options: [{ label: "Auth" }, { label: "Cache" }],
    },
  ],
};

function show(lang: "en" | "pt-BR" = "en") {
  render(
    <ApprovalCard
      request={{
        requestId: "r1",
        toolName: "AskUserQuestion",
        input: QUESTIONS,
        cwd: null,
        createdAt: null,
      }}
      t={translator(lang)}
      nowMs={NOW}
      onRespond={() => {}}
    />,
  );
}
const pick = (name: RegExp, role: "radio" | "checkbox") =>
  act(async () => {
    const el = screen.queryByRole(role, { name });
    if (el) fireEvent.click(el);
  });
const inside = (question: string, role: "radio" | "checkbox", name: RegExp) => {
  const group = screen.queryByRole("group", { name: question });
  return group ? within(group).queryByRole(role, { name }) : null;
};

describe("question card groups (issue #4161)", () => {
  test("Given a single-choice question, Then its radios sit in a group named by the question", () => {
    show();
    expect(inside("Which database?", "radio", /SQLite/)).not.toBeNull();
    expect(inside("Which database?", "radio", /Postgres/)).not.toBeNull();
  });

  test("Given a multi-select question, Then its checkboxes sit in a group named by the question", () => {
    show();
    expect(inside("Which extras?", "checkbox", /Auth/)).not.toBeNull();
    expect(inside("Which extras?", "checkbox", /Cache/)).not.toBeNull();
  });
});

describe("Send answers says why it is disabled (issue #4161)", () => {
  test("Given no pick, Then the reason is visible text and the button is described by it", () => {
    show();
    const send = screen.queryByRole("button", { name: "Send answers" });
    const reason = screen.queryByText("Answer every question first");
    expect(reason).not.toBeNull();
    expect(Boolean(send && reason && send.getAttribute("aria-describedby") === reason.id)).toBe(
      true,
    );
  });

  test("Given every question has a pick, Then the button is on and the reason is gone", async () => {
    show();
    await pick(/Postgres/, "radio");
    expect(screen.queryByText("Answer every question first")).not.toBeNull();
    await pick(/Auth/, "checkbox");
    const send = screen.queryByRole("button", { name: "Send answers" }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    expect(screen.queryAllByText("Answer every question first")).toHaveLength(0);
  });

  test("Given pt-BR, Then the reason is in Portuguese", () => {
    show("pt-BR");
    expect(screen.queryByText("Responda todas as perguntas primeiro")).not.toBeNull();
  });
});
