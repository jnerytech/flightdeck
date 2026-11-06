import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { translator } from "../src/i18n/index.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, within, waitFor } = await import("@testing-library/react");
const screen = liveScreen(within);
const { ApprovalCard } = await import("../src/components/approval/approval-card.tsx");

setDefaultTimeout(30_000);
afterEach(cleanup);

const t = translator("en");
const NOW = Date.parse("2026-11-02T12:00:00.000Z");

const QUESTIONS = {
  questions: [
    {
      question: "Which database?",
      header: "Database",
      multiSelect: false,
      options: [
        { label: "SQLite", description: "Embedded" },
        { label: "Postgres", description: "Server" },
      ],
    },
    {
      question: "Which extras?",
      header: "Extras",
      multiSelect: true,
      options: [
        { label: "Auth", description: "Login" },
        { label: "Cache", description: "Speed" },
      ],
    },
  ],
};

function card(toolName: string, input: Record<string, unknown>) {
  const calls: unknown[][] = [];
  render(
    <ApprovalCard
      request={{ requestId: "r1", toolName, input, cwd: null, createdAt: null }}
      t={t}
      nowMs={NOW}
      onRespond={(...args: unknown[]) => {
        calls.push(args);
      }}
    />,
  );
  return calls;
}
const click = (el: HTMLElement | null) =>
  act(async () => {
    if (el) fireEvent.click(el);
  });

describe("ask-question-ui", () => {
  test("AskUserQuestion shows each question with its header and options, never [object Object]", () => {
    card("AskUserQuestion", QUESTIONS);
    expect(screen.queryByText("Database")).not.toBeNull();
    expect(screen.queryByText("Which database?")).not.toBeNull();
    expect(screen.queryByRole("radio", { name: /SQLite/ })).not.toBeNull();
    expect(screen.queryByText("Embedded")).not.toBeNull();
    expect(screen.queryByRole("checkbox", { name: /Auth/ })).not.toBeNull();
    expect(document.body.textContent).not.toContain("[object Object]");
  });

  test("Send answers waits for every question, then answers with the labels", async () => {
    const calls = card("AskUserQuestion", QUESTIONS);
    const send = () => screen.queryByRole("button", { name: "Send answers" });
    expect(send()).not.toBeNull();
    expect((send() as HTMLButtonElement).disabled).toBe(true);
    await click(screen.queryByRole("radio", { name: /Postgres/ }));
    expect((send() as HTMLButtonElement).disabled).toBe(true);
    await click(screen.queryByRole("checkbox", { name: /Auth/ }));
    await click(screen.queryByRole("checkbox", { name: /Cache/ }));
    expect((send() as HTMLButtonElement).disabled).toBe(false);
    await click(send());
    expect(calls).toEqual([
      [
        "allow",
        undefined,
        undefined,
        {
          ...QUESTIONS,
          answers: { "Which database?": "Postgres", "Which extras?": "Auth, Cache" },
        },
      ],
    ]);
  });

  test("a checked option can be unchecked, which takes it out of the answer", async () => {
    card("AskUserQuestion", { questions: [QUESTIONS.questions[1]] });
    const auth = () => screen.queryByRole("checkbox", { name: /Auth/ }) as HTMLInputElement;
    await click(auth());
    expect(auth().checked).toBe(true);
    await click(auth());
    expect(auth().checked).toBe(false);
    expect(
      (screen.queryByRole("button", { name: "Send answers" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test("the Other text answers a question on its own", async () => {
    const calls = card("AskUserQuestion", {
      questions: [QUESTIONS.questions[0]],
    });
    const other = screen.queryByRole("textbox", { name: /Other/ });
    expect(other).not.toBeNull();
    await act(async () => {
      if (other) fireEvent.change(other, { target: { value: "DuckDB" } });
    });
    await click(screen.queryByRole("button", { name: "Send answers" }));
    expect(((calls[0]?.[3] ?? {}) as { answers?: unknown }).answers).toEqual({
      "Which database?": "DuckDB",
    });
  });

  test("a question can be declined with a reason, and Cancel brings the answers back", async () => {
    const calls = card("AskUserQuestion", { questions: [QUESTIONS.questions[0]] });
    await click(screen.queryByRole("button", { name: "Deny" }));
    expect(screen.queryByRole("button", { name: "Send answers" })).toBeNull();
    await click(screen.queryByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Send answers" })).not.toBeNull();
    await click(screen.queryByRole("button", { name: "Deny" }));
    const reason = screen.queryByRole("textbox", { name: "Reason (optional)" }) as HTMLElement;
    await act(async () => {
      fireEvent.change(reason, { target: { value: "not now" } });
    });
    await click(screen.queryAllByRole("button", { name: "Deny" }).at(-1) ?? null);
    expect(calls).toEqual([["deny", "not now"]]);
  });

  test("ExitPlanMode shows the plan as markdown, with Approve plan and Keep planning", async () => {
    const calls = card("ExitPlanMode", { plan: "# The plan\n\n- step one\n- step two" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "The plan" })).not.toBeNull());
    expect(screen.queryAllByRole("listitem")).toHaveLength(2);
    await click(screen.queryByRole("button", { name: "Approve plan" }));
    expect(calls).toEqual([["allow"]]);
    expect(screen.queryByRole("button", { name: "Keep planning" })).not.toBeNull();
  });

  test("any other tool input with objects in lists reads as JSON", () => {
    card("Mystery", { items: [{ a: 1 }, { b: [2] }] });
    expect(document.body.textContent).not.toContain("[object Object]");
    expect(document.body.textContent).toContain('{"a":1}');
  });
});
