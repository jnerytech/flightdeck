import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { visibleTsLiterals } from "../../../scripts/lib/i18n-sweep.ts";

const ROOT = resolve(import.meta.dir, "..");

/** Where text for a person can hide outside the JSX: the lib, the screens, the hooks, the parts, the platform. */
const FILES = [
  ...new Bun.Glob("src/{lib,ui,hooks,components,platform}/**/*.{ts,tsx}").scanSync(ROOT),
];

/** Names that are not translated, and the code the `error:` key of a table also matches. */
const ALLOWED = [
  "Flightdeck",
  "Backlog",
  "main",
  "ended",
  "bg-status-error",
  "border border-status-error bg-transparent",
  "border-status-error/40 text-status-error",
];

describe("textos-varredura", () => {
  test("há arquivos para varrer", () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  test("nenhum texto visível montado fora do JSX (tabelas, objetos, mensagens) fica fora do dicionário", () => {
    const left = FILES.flatMap((file) =>
      visibleTsLiterals(readFileSync(resolve(ROOT, file), "utf8"), ALLOWED).map(
        (l) => `${file.replaceAll("\\", "/")}:${l.line} ${l.text}`,
      ),
    );
    expect(left).toEqual([]);
  });
});
