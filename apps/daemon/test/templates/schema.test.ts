import { describe, expect, test } from "bun:test";
import { Template } from "@flightdeck/protocol";
import { BUILTIN_TEMPLATES } from "../src/templates/builtin.ts";

const both = (en: string, ptBr = `${en} (pt)`) => ({ en, "pt-BR": ptBr });

const valid = () => ({
  id: "summarise",
  title: both("Summarise a folder"),
  description: both("Reads a folder and tells you what is in it."),
  icon: "folder-search",
  fields: [
    { id: "folder", kind: "folder", label: both("Folder") },
    { id: "focus", kind: "text", label: both("What matters to you?"), optional: true },
  ],
  prompt: both("Summarise the files in {folder}. Focus on {focus}."),
  preset: "read_only",
  planFirst: false,
});

const parses = (value: unknown) => Template.safeParse(value).success;

describe("templates-schema: what a template may say", () => {
  test("Given a template with a title, fields, a prompt and a preset, When it is parsed, Then it is accepted", () => {
    expect(parses(valid())).toBe(true);
  });

  test("Given no field or more than three, When parsed, Then it is rejected", () => {
    expect(parses({ ...valid(), fields: [] })).toBe(false);
    const field = (id: string) => ({ id, kind: "text", label: both(id) });
    const four = ["a", "b", "c", "d"].map(field);
    expect(parses({ ...valid(), fields: four, prompt: both("{a} {b} {c} {d}") })).toBe(false);
    expect(parses({ ...valid(), fields: four.slice(0, 3), prompt: both("{a} {b} {c}") })).toBe(
      true,
    );
  });

  test("Given a title or a prompt in only one language, When parsed, Then it is rejected", () => {
    expect(parses({ ...valid(), title: { en: "Only English" } })).toBe(false);
    expect(parses({ ...valid(), prompt: { "pt-BR": "{folder}" } })).toBe(false);
  });

  test("Given a preset above edit this folder, When parsed, Then it is rejected; the three presets are accepted", () => {
    for (const preset of ["read_only", "ask_before_changes", "edit_folder"]) {
      expect(parses({ ...valid(), preset })).toBe(true);
    }
    for (const preset of ["bypassPermissions", "auto", "dontAsk", "edit_everything"]) {
      expect(parses({ ...valid(), preset })).toBe(false);
    }
  });

  test("Given a prompt with a placeholder no field has, When parsed, Then it is rejected", () => {
    expect(parses({ ...valid(), prompt: both("Summarise {folder} for {boss}") })).toBe(false);
    expect(parses({ ...valid(), prompt: both("Summarise {folder}", "Resuma {pasta}") })).toBe(
      false,
    );
  });

  test("Given two fields with the same id, When parsed, Then it is rejected", () => {
    const fields = [
      { id: "folder", kind: "folder", label: both("A") },
      { id: "folder", kind: "folder", label: both("B") },
    ];
    expect(parses({ ...valid(), fields })).toBe(false);
  });

  test("Given a choice with fewer than two options, or options on another kind, When parsed, Then it is rejected", () => {
    const choice = (choices?: unknown, kind = "choice") => ({
      ...valid(),
      fields: [{ id: "folder", kind, label: both("Pick"), ...(choices ? { choices } : {}) }],
      prompt: both("Do {folder}"),
    });
    const options = [
      { id: "short", label: both("Short") },
      { id: "long", label: both("Long") },
    ];
    expect(parses(choice(options))).toBe(true);
    expect(parses(choice(options.slice(0, 1)))).toBe(false);
    expect(parses(choice())).toBe(false);
    expect(parses(choice(options, "text"))).toBe(false);
  });

  test("Given a template id that is not a safe name, When parsed, Then it is rejected", () => {
    for (const id of ["", "Has Space", "../up", "UPPER"])
      expect(parses({ ...valid(), id })).toBe(false);
  });
});

describe("templates-schema: the built-in templates", () => {
  test("Given the daemon, When it lists the built-ins, Then there are the four of the first cut, each valid", () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.id)).toEqual([
      "summarise-folder",
      "draft-report",
      "review-document",
      "compare-files",
    ]);
    for (const template of BUILTIN_TEMPLATES) {
      expect(Template.safeParse(template).success).toBe(true);
    }
  });

  test("Given a built-in, When read in either language, Then nothing is empty and the pt-BR text is not the English one", () => {
    for (const template of BUILTIN_TEMPLATES) {
      expect(template.title["pt-BR"]).not.toBe(template.title.en);
      expect(template.prompt["pt-BR"]).not.toBe(template.prompt.en);
      expect(template.description.en.length).toBeGreaterThan(10);
      // Written for people: none of the technical words the simple mode hides.
      const text = JSON.stringify(template).toLowerCase();
      for (const word of ["session", "worktree", "bypass", "mcp", "json"]) {
        expect(text).not.toContain(word);
      }
    }
  });

  test("Given the built-ins, Then none asks for more than editing the chosen folder, and report and compare only read or ask", () => {
    const byId = Object.fromEntries(BUILTIN_TEMPLATES.map((t) => [t.id, t.preset]));
    expect(byId["summarise-folder"]).toBe("read_only");
    expect(byId["compare-files"]).toBe("read_only");
    expect(byId["review-document"]).toBe("read_only");
    expect(["ask_before_changes", "edit_folder"]).toContain(byId["draft-report"] as string);
  });
});
