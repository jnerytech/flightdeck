import { describe, expect, test } from "bun:test";
import { SnippetInput } from "@flightdeck/protocol";
import type { DemoIds } from "../../demo-seed.ts";
import {
  DEMO_EDIT_PROMPT,
  DEMO_FILE_SNIPPETS,
  DEMO_IMPORT_FILE,
  DEMO_SHELL_HISTORY,
  DEMO_SNIPPETS,
  DEMO_USE_COMMAND,
} from "../../lib/demo/snippets.ts";
import { snippetShots } from "../../lib/shots/table-snippets.ts";

const IDS = { project: "p1", projectName: "web" } as DemoIds;
const SHOTS = () => snippetShots(IDS);

describe("the Snippets prints (#3973)", () => {
  test("the table prints the list, the editor, the use dialog, a project's file and both imports", () => {
    expect(SHOTS().map((shot) => shot.name)).toEqual([
      "snippets-lista",
      "snippets-editor",
      "snippets-usar",
      "snippets-projeto",
      "snippets-historico",
      "snippets-arquivo",
    ]);
  });

  test("each print opens the Snippets screen", () => {
    expect(SHOTS()).toHaveLength(6);
    expect(SHOTS().every((shot) => shot.route.name === "snippets")).toBe(true);
    expect(
      SHOTS().every((shot) => typeof shot.prepare === "function" || shot.name === "snippets-lista"),
    ).toBe(true);
  });
});

describe("the snippets the demo seeds (#3973)", () => {
  test("the host has a command and a prompt, one favorite, and the names are different", () => {
    const names = DEMO_SNIPPETS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(DEMO_SNIPPETS.some((s) => s.type === "command")).toBe(true);
    expect(DEMO_SNIPPETS.some((s) => s.type === "prompt")).toBe(true);
    expect(DEMO_SNIPPETS.filter((s) => s.favorite)).toHaveLength(1);
  });

  test("each one is an input the daemon accepts", () => {
    for (const { favorite: _favorite, ...input } of DEMO_SNIPPETS) {
      expect(SnippetInput.safeParse(input).success).toBe(true);
    }
    for (const input of DEMO_FILE_SNIPPETS)
      expect(SnippetInput.safeParse(input).success).toBe(true);
    expect(DEMO_FILE_SNIPPETS.length).toBeGreaterThan(0);
  });

  test("the use dialog's command and the editor's prompt are seeded, and the command has a field to fill", () => {
    const command = DEMO_SNIPPETS.find((s) => s.name === DEMO_USE_COMMAND);
    expect(command?.type).toBe("command");
    expect(Object.keys(command?.vars ?? {}).length).toBeGreaterThan(0);
    expect(DEMO_SNIPPETS.find((s) => s.name === DEMO_EDIT_PROMPT)?.type).toBe("prompt");
  });

  test("the history has a command that repeats and the file import is a list of snippets", () => {
    const lines = DEMO_SHELL_HISTORY.split("\n").filter((line) => line !== "");
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.length).toBeGreaterThan(new Set(lines).size);
    expect(DEMO_IMPORT_FILE).toContain("name:");
  });
});
