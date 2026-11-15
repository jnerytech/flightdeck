import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listPersonaNames, readPersonaSource } from "../../src/personas/adapters/persona-files.ts";
import { workspace } from "../support/helpers.ts";

function projectWith(files: Record<string, string>): string {
  const { project } = workspace();
  const dir = join(project, ".flightdeck", "personas");
  mkdirSync(dir, { recursive: true });
  for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source);
  return project;
}

describe("a project's persona files", () => {
  test("a listed .md file is read and its name comes back in code unit order", async () => {
    const project = projectWith({
      "b.md": "second",
      "a.md": "first",
      "notes.txt": "not a persona",
    });
    expect(await listPersonaNames(project)).toEqual(["a.md", "b.md"]);
    expect(await readPersonaSource(project, "a.md")).toBe("first");
  });

  test("a name that is not a .md file is refused, whatever it holds", async () => {
    const project = projectWith({ "notes.txt": "not a persona" });
    await expect(readPersonaSource(project, "notes.txt")).rejects.toMatchObject({
      reason: "persona_id_invalid",
    });
  });

  test("a name that leaves the personas folder is refused, even when it ends in .md", async () => {
    const project = projectWith({});
    writeFileSync(join(project, "outside.md"), "not in the folder");
    await expect(readPersonaSource(project, "../../outside.md")).rejects.toMatchObject({
      reason: "persona_id_invalid",
    });
  });
});
