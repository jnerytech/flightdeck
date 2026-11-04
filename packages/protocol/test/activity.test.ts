import { describe, expect, test } from "bun:test";
import { type TaskActivity, type ToolEvent, taskActivity } from "../src/activity.ts";
import type { QuestionLanguage } from "../src/question.ts";

const read = (path: string): ToolEvent => ({ name: "Read", input: { file_path: path } });
const write = (path: string): ToolEvent => ({ name: "Write", input: { file_path: path } });
const bash = (command = "ls"): ToolEvent => ({ name: "Bash", input: { command } });
const grep = (): ToolEvent => ({ name: "Grep", input: { pattern: "x" } });

const now = (tools: ToolEvent[], language: QuestionLanguage = "en", working = true): TaskActivity =>
  taskActivity(tools, language, working);

describe("task-activity: one live sentence about what the task is doing", () => {
  test("Given twelve files read in one folder, When asked, Then it counts them and names the folder", () => {
    const tools = Array.from({ length: 12 }, (_, i) => read(`/home/ana/Notes/n${i}.md`));
    expect(now(tools)).toEqual({ kind: "reading", count: 12, text: "Reading 12 files in Notes" });
  });

  test("Given one file read, Then it names the file; the same file twice is still one", () => {
    expect(now([read("/w/plan.pdf")]).text).toBe("Reading plan.pdf");
    expect(now([read("/w/plan.pdf"), read("/w/plan.pdf")]).count).toBe(1);
  });

  test("Given files read in different folders, Then the folder is left out", () => {
    expect(now([read("/a/x.md"), read("/b/y.md")]).text).toBe("Reading 2 files");
  });

  test("Given searches, Then it says it is looking through the files", () => {
    expect(now([grep(), { name: "Glob", input: { pattern: "*.md" } }])).toEqual({
      kind: "searching",
      count: 2,
      text: "Looking through your files",
    });
  });

  test("Given files written, Then it says writing, the file or the count and the folder", () => {
    expect(now([write("/w/Reports/report.md")]).text).toBe("Writing report.md");
    expect(now([write("/w/Reports/a.md"), write("/w/Reports/b.md")]).text).toBe(
      "Writing 2 files in Reports",
    );
  });

  test("Given commands, Then it says working on a step, and counts the steps", () => {
    expect(now([bash()])).toEqual({ kind: "running", count: 1, text: "Working on a step" });
    expect(now([bash(), bash("pwd"), bash("date")]).text).toBe("Working on 3 steps");
  });

  test("Given a burst of reads and then a write, Then only the latest burst shows", () => {
    const tools = [read("/w/a.md"), read("/w/b.md"), write("/w/Out/report.md")];
    expect(now(tools)).toMatchObject({ kind: "writing", count: 1 });
  });

  test("Given nothing done yet while working, Then it is thinking; when not working it is idle", () => {
    expect(now([]).kind).toBe("thinking");
    expect(now([read("/w/a.md")], "en", false).kind).toBe("idle");
    expect(now([], "en", false).text.length).toBeGreaterThan(3);
  });

  test("Given Portuguese, Then the sentences are Portuguese", () => {
    const tools = Array.from({ length: 12 }, (_, i) => read(`/home/ana/Notas/n${i}.md`));
    expect(now(tools, "pt-BR").text).toBe("Lendo 12 arquivos em Notas");
    expect(now([write("/w/relatório.md")], "pt-BR").text).toBe("Escrevendo relatório.md");
    expect(now([bash()], "pt-BR").text).toBe("Trabalhando em uma etapa");
    expect(now([grep()], "pt-BR").text).toBe("Olhando os seus arquivos");
  });

  test("Given any burst in either language, Then no tool name shows", () => {
    const bursts = [
      [read("/w/a")],
      [grep()],
      [write("/w/a")],
      [bash()],
      [{ name: "mcp__x__y", input: {} }],
      [],
    ];
    for (const language of ["en", "pt-BR"] as const) {
      for (const tools of bursts) {
        expect(now(tools, language).text).not.toMatch(/\b(Read|Grep|Glob|Write|Bash)\b|mcp__/);
      }
    }
  });
});
