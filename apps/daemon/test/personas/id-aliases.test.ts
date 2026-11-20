import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { packPersonas } from "../../src/personas/index.ts";
import { Personas } from "../../src/personas/store.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { workspace } from "../support/helpers.ts";
import { codeOf, input, scanner } from "./model-setup.ts";

// #3413: four pack persona ids were Portuguese. The old ids still reach the same persona.
const RENAMED = [
  ["arquiteto", "architect"],
  ["coordenador", "coordinator"],
  ["revisor", "reviewer"],
  ["seguranca", "security"],
] as const;

function setup() {
  const { root, project } = workspace();
  const store = new EventStore(":memory:");
  const personas = new Personas({
    db: store.db,
    allowedRoots: [root],
    scanner,
    pack: packPersonas,
  });
  return { project, personas };
}

describe("persona ids that were Portuguese (#3413)", () => {
  test("the pack ships the English ids, in both languages", () => {
    for (const language of ["en", "pt-BR"] as const) {
      const ids = packPersonas(language).map((persona) => persona.id);
      for (const [old, current] of RENAMED) {
        expect(ids).toContain(current);
        expect(ids).not.toContain(old);
      }
    }
  });

  test("an old id gets the persona that has the new id", async () => {
    const { personas } = setup();
    for (const language of ["en", "pt-BR"] as const) {
      for (const [old, current] of RENAMED) {
        expect((await personas.get(old, { language })).id).toBe(current);
        expect((await personas.resolve({ id: old }, { language })).persona.id).toBe(current);
      }
    }
  });

  test("a project persona file with the old id is not shadowed by the alias", async () => {
    const { personas, project } = setup();
    const dir = join(project, ".flightdeck", "personas");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "revisor.md"),
      "---\nid: revisor\nname: Mine\ndescription: Reviews changes the way this project wants them reviewed\n---\nThe project's own reviewer.\n",
    );
    const mine = await personas.get("revisor", { projectPath: project, language: "en" });
    expect(mine.scope).toBe("project");
    expect(mine.id).toBe("revisor");
  });

  test("a host persona with the old id, saved by the person, wins over the alias", async () => {
    const { personas } = setup();
    await personas.save({ scope: "host", persona: input({ id: "revisor", name: "Mine" }) });
    expect((await personas.get("revisor", { language: "en" })).name).toBe("Mine");
  });

  test("reset and remove take an old id too", async () => {
    const { personas } = setup();
    await personas.save({
      scope: "host",
      persona: input({ id: "reviewer", name: "Edited reviewer" }),
    });
    expect((await personas.get("reviewer", { language: "en" })).modified).toBe(true);
    expect(personas.reset("revisor", { language: "en" }).modified).toBe(false);
    expect(await codeOf(() => personas.remove("host", "revisor"))).toBe("not_found");
  });
});
