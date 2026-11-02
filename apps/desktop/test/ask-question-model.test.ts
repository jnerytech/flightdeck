import { describe, expect, test } from "bun:test";
import { approvalView, fields } from "../src/lib/approval.ts";
import { answeredInput, buildAnswers, parseQuestions } from "../src/lib/ask-question.ts";

const INPUT = {
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
      options: [{ label: "Auth", description: "Login" }, { label: "Cache" }],
    },
  ],
};

describe("ask-question-model", () => {
  test("parses the questions with header, options and multiSelect", () => {
    const questions = parseQuestions(INPUT);
    expect(questions).toHaveLength(2);
    expect(questions?.[0]).toEqual({
      question: "Which database?",
      header: "Database",
      multiSelect: false,
      options: [
        { label: "SQLite", description: "Embedded" },
        { label: "Postgres", description: "Server" },
      ],
    });
    // A missing description reads as empty; a missing multiSelect as single choice.
    expect(questions?.[1]?.options[1]).toEqual({ label: "Cache", description: "" });
  });

  test("an input that is not a list of questions parses to null", () => {
    expect(parseQuestions({})).toBeNull();
    expect(parseQuestions({ questions: "x" })).toBeNull();
    expect(parseQuestions({ questions: [] })).toBeNull();
    expect(parseQuestions({ questions: [{ header: "no question text" }] })).toBeNull();
    expect(parseQuestions({ questions: [{ question: "q", options: [{ nolabel: 1 }] }] })).toBeNull();
  });

  test("answers: the label for a single choice, labels joined for several, the Other text over a label", () => {
    const questions = parseQuestions(INPUT) ?? [];
    expect(
      buildAnswers(questions, {
        "Which database?": { labels: ["Postgres"], other: "" },
        "Which extras?": { labels: ["Auth", "Cache"], other: "" },
      }),
    ).toEqual({ "Which database?": "Postgres", "Which extras?": "Auth, Cache" });
    expect(
      buildAnswers(questions, {
        "Which database?": { labels: ["Postgres"], other: "  DuckDB " },
        "Which extras?": { labels: ["Auth"], other: "Logs" },
      }),
    ).toEqual({ "Which database?": "DuckDB", "Which extras?": "Auth, Logs" });
  });

  test("a question left unanswered makes the whole answer null", () => {
    const questions = parseQuestions(INPUT) ?? [];
    expect(
      buildAnswers(questions, { "Which database?": { labels: ["SQLite"], other: "" } }),
    ).toBeNull();
    expect(
      buildAnswers(questions, {
        "Which database?": { labels: [], other: "" },
        "Which extras?": { labels: ["Auth"], other: "" },
      }),
    ).toBeNull();
  });

  test("the answered input keeps the questions and adds the answers", () => {
    expect(answeredInput(INPUT, { "Which database?": "SQLite" })).toEqual({
      ...INPUT,
      answers: { "Which database?": "SQLite" },
    });
  });

  test("no tool input renders as [object Object]: nested objects in lists become JSON", () => {
    const shown = fields({ questions: INPUT.questions, list: [1, "a"], nested: { a: [{ b: 1 }] } });
    for (const [, value] of shown) expect(value).not.toContain("[object Object]");
    expect(shown.find(([k]) => k === "list")?.[1]).toBe("1, a");
    expect(shown.find(([k]) => k === "nested.a")?.[1]).toBe('{"b":1}');
    const view = approvalView("AskUserQuestion", INPUT, null);
    expect(JSON.stringify(view)).not.toContain("[object Object]");
  });
});
