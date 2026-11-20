import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const PACK = join(import.meta.dir, "../../src/personas/pack");
const OLD = ["arquiteto", "coordenador", "revisor", "seguranca"];
const RENAMED = ["architect", "coordinator", "reviewer", "security"];

describe("persona pack: file names are English (#3412)", () => {
  for (const language of ["en", "pt-BR"]) {
    test(`${language}: the four renamed files carry English names and no Portuguese name is left`, () => {
      const names = readdirSync(join(PACK, language)).map((file) => file.replace(/\.md$/, ""));
      expect([
        language,
        OLD.filter((name) => names.includes(name)),
        RENAMED.filter((name) => !names.includes(name)),
      ]).toEqual([language, [], []]);
    });
  }
});
