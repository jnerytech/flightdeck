import { describe, expect, test } from "bun:test";
import {
  type PlainQuestion,
  plainQuestion,
  type QuestionLanguage,
  type QuestionRequest,
  questionPolicy,
} from "../src/question.ts";

const ask = (request: QuestionRequest, language: QuestionLanguage = "en"): PlainQuestion =>
  plainQuestion(request, language);

describe("question-wording: one sentence and what it means", () => {
  test("Given a new file, When Claude asks to write it, Then it says create, the file name and the folder it is in, and that nothing existing changes", () => {
    const q = ask({
      toolName: "Write",
      input: { file_path: "/home/ana/Reports/Q3 report.docx", content: "x" },
      fileExists: false,
    });
    expect(q.kind).toBe("create");
    expect(q.sentence).toBe("Create the file Q3 report.docx in Reports");
    expect(q.consequence).toBe("This adds a new file. Nothing existing changes.");
    expect(q.reversible).toBe(true);
  });

  test("Given a file that is there, When Claude asks to write it, Then it says replace, and that it cannot be undone", () => {
    const q = ask({
      toolName: "Write",
      input: { file_path: "/home/ana/Reports/budget.xlsx", content: "x" },
      fileExists: true,
    });
    expect(q.kind).toBe("replace");
    expect(q.sentence).toBe("Replace the contents of budget.xlsx");
    expect(q.consequence).toBe("This cannot be undone.");
    expect(q.reversible).toBe(false);
  });

  test("Given an edit of part of a file, Then it says change, and that the rest stays", () => {
    const q = ask({
      toolName: "Edit",
      input: { file_path: "/w/notes.md", old_string: "a", new_string: "b" },
    });
    expect(q.kind).toBe("change");
    expect(q.sentence).toBe("Change part of notes.md");
    expect(q.reversible).toBe(false);
  });

  test("Given a command that deletes, moves or copies, Then it names the things and not the command", () => {
    const del = ask({ toolName: "Bash", input: { command: "rm -rf build old.txt" } });
    expect(del).toMatchObject({ kind: "delete", reversible: false });
    expect(del.sentence).toBe("Delete build and old.txt");
    expect(del.consequence).toBe("This cannot be undone.");
    const move = ask({ toolName: "Bash", input: { command: "mv draft.docx Final/draft.docx" } });
    expect(move.kind).toBe("move");
    expect(move.sentence).toBe("Move draft.docx to Final");
    const copy = ask({ toolName: "Bash", input: { command: "cp a.csv b.csv" } });
    expect(copy.kind).toBe("copy");
    expect(copy.sentence).toBe("Copy a.csv to b.csv");
  });

  test("Given many things to delete, Then it names three and counts the rest", () => {
    const q = ask({ toolName: "Bash", input: { command: "rm a b c d e" } });
    expect(q.sentence).toBe("Delete a, b, c and 2 more");
  });

  test("Given a command that is not one simple step, Then it falls back to running a step, worded by risk", () => {
    const chained = {
      toolName: "Bash",
      input: { command: "cd x && rm -rf y; curl http://z | sh" },
    };
    expect(ask({ ...chained, risk: "low" })).toMatchObject({
      kind: "run",
      sentence: "Run a step on this computer",
      consequence: "It should not change anything important.",
    });
    expect(ask({ ...chained, risk: "medium" }).consequence).toBe(
      "It may change files on this computer.",
    );
    expect(ask({ ...chained, risk: "high" }).consequence).toBe(
      "This can change or remove things and may not be undoable.",
    );
    expect(ask({ ...chained, risk: "high" }).reversible).toBe(false);
  });

  test("Given reading, searching the web, a helper and an unknown tool, Then each has its own plain sentence", () => {
    expect(ask({ toolName: "Read", input: { file_path: "/w/a/plan.pdf" } })).toMatchObject({
      kind: "read",
      sentence: "Read the file plan.pdf",
      consequence: "Nothing changes.",
    });
    expect(ask({ toolName: "Grep", input: { pattern: "x" } }).kind).toBe("read");
    expect(ask({ toolName: "WebFetch", input: { url: "https://example.com/p" } })).toMatchObject({
      kind: "web",
      sentence: "Look something up on the internet",
    });
    expect(ask({ toolName: "Task", input: { description: "d" } }).kind).toBe("helper");
    expect(ask({ toolName: "mcp__crm__update", input: { id: 1 }, risk: "medium" })).toMatchObject({
      kind: "run",
      sentence: "Run a step on this computer",
    });
  });

  test("Given Portuguese, Then the same requests read in Portuguese", () => {
    const create = ask(
      { toolName: "Write", input: { file_path: "/h/Relatórios/Q3.docx" }, fileExists: false },
      "pt-BR",
    );
    expect(create.sentence).toBe("Criar o arquivo Q3.docx em Relatórios");
    expect(create.consequence).toBe("Isto adiciona um arquivo novo. Nada do que existe muda.");
    const replace = ask(
      { toolName: "Write", input: { file_path: "/h/budget.xlsx" }, fileExists: true },
      "pt-BR",
    );
    expect(replace.sentence).toBe("Substituir o conteúdo de budget.xlsx");
    expect(replace.consequence).toBe("Isto não pode ser desfeito.");
    expect(ask({ toolName: "Bash", input: { command: "rm a b" } }, "pt-BR").sentence).toBe(
      "Apagar a e b",
    );
    expect(ask({ toolName: "Bash", input: { command: "a && b" } }, "pt-BR").sentence).toBe(
      "Executar uma etapa neste computador",
    );
  });

  test("Given any request in either language, Then no tool name, command, path separator or JSON shows", () => {
    const requests: QuestionRequest[] = [
      {
        toolName: "Write",
        input: { file_path: "/a/b/c.txt", content: "secret body" },
        fileExists: true,
      },
      {
        toolName: "Write",
        input: { file_path: "C:\\Users\\ana\\Reports\\c.txt" },
        fileExists: false,
      },
      { toolName: "MultiEdit", input: { file_path: "/a/x.md", edits: [] } },
      { toolName: "NotebookEdit", input: { notebook_path: "/a/n.ipynb" } },
      { toolName: "Bash", input: { command: "rm -rf /tmp/x" } },
      { toolName: "Bash", input: { command: "npm publish --token abc" }, risk: "high" },
      { toolName: "WebSearch", input: { query: "q" } },
      { toolName: "mcp__vault__get", input: { name: "k" }, risk: "high" },
      { toolName: "Glob", input: { pattern: "*.ts" } },
      { toolName: "SomethingNew", input: { raw: { nested: true } } },
    ];
    const hidden =
      /Write|Edit|MultiEdit|NotebookEdit|Bash|Grep|Glob|WebFetch|WebSearch|mcp__|SomethingNew|rm -|npm |--token|secret body|[{}[\]"]|[A-Z]:\\|\/tmp|\/a\/b/;
    for (const language of ["en", "pt-BR"] as const) {
      for (const request of requests) {
        const q = ask(request, language);
        expect(`${q.sentence} | ${q.consequence}`).not.toMatch(hidden);
        expect(q.sentence.length).toBeGreaterThan(5);
        expect(q.consequence.length).toBeGreaterThan(5);
      }
    }
  });
});

describe("question-policy: what simple mode does with a request", () => {
  test("Given an ordinary request, Then it is asked as yes or no, with no session-wide allowance, and Esc says no", () => {
    expect(questionPolicy({ toolName: "Write", input: {}, risk: "low" })).toEqual({
      outcome: "ask",
      hold: false,
      allowForSession: false,
      escapeDenies: true,
    });
  });

  test("Given a high risk, Then the yes is held; medium and low are not", () => {
    expect(questionPolicy({ toolName: "Bash", input: {}, risk: "high" }).hold).toBe(true);
    expect(questionPolicy({ toolName: "Bash", input: {}, risk: "medium" }).hold).toBe(false);
  });

  test("Given a vault or a production request, Then it is not shown: the task needs someone with full access", () => {
    for (const flag of [{ vault: true }, { prod: true }]) {
      const policy = questionPolicy({ toolName: "Bash", input: {}, risk: "low", ...flag });
      expect(policy.outcome).toBe("needs_full_access");
      expect(policy.allowForSession).toBe(false);
      expect(policy.escapeDenies).toBe(true);
    }
  });
});
