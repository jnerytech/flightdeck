import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type AxeViolation, blocking, describeViolation } from "../../../scripts/lib/axe.ts";
import { ACOES_ACTION, JOURNEYS, LANGUAGES, VIEWPORTS } from "../../../scripts/lib/e2e-journeys.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");

const violation = (
  id: string,
  impact: string | null,
  targets: string[] = ["#a"],
): AxeViolation => ({
  id,
  impact,
  help: `ajuda de ${id}`,
  nodes: targets.map((target) => ({ target: [target] })),
});

describe("demo-prints: axe e CI", () => {
  test("só violações serious e critical reprovam; minor, moderate e sem impacto passam", () => {
    const all = [
      violation("a", "minor"),
      violation("b", "serious"),
      violation("c", "moderate"),
      violation("d", "critical"),
      violation("e", null),
    ];
    expect(blocking(all).map((v) => v.id)).toEqual(["b", "d"]);
    expect(blocking([])).toEqual([]);
  });

  test("a linha de cada violação diz a tela, a regra, a gravidade e os primeiros elementos", () => {
    const line = describeViolation(
      "light pt-BR hub",
      violation("color-contrast", "serious", ["#a", "#b", "#c", "#d"]),
    );
    expect(line).toBe(
      "light pt-BR hub: color-contrast (serious): ajuda de color-contrast [#a, #b, #c]",
    );
  });

  test("o CI tem o job screenshots no ubuntu: prints, axe, e2e e o artefato", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("  screenshots:");
    const job = ci.slice(ci.indexOf("  screenshots:"));
    expect(job).toContain("runs-on: ubuntu-latest");
    expect(job).toContain("bun run demo:shots");
    expect(job).toContain("bun run e2e");
    expect(job).toContain("actions/upload-artifact");
    expect(job).toContain("apps/desktop/screenshots");
  });

  test("o package.json tem os comandos e2e e demo, com o axe fixado", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts.e2e).toBe("bun run scripts/demo.ts --e2e");
    expect(pkg.scripts.demo).toBe("bun run scripts/demo.ts");
    expect(pkg.devDependencies["axe-core"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("e2e: the eleven journeys, in both languages, checked at 1280x800 and 800x600", () => {
    expect(JOURNEYS).toEqual([
      "aprovar-bash-com-a",
      "sessao-e-mensagem",
      "card-diff",
      "revisao-comentar-e-enviar",
      "paleta-e-leitor",
      "tema-e-idioma",
      "voltar-arquivos",
      "issue-e-risco",
      "abas-terminal",
      "acoes",
      "regras",
    ]);
    expect(LANGUAGES).toEqual(["pt-BR", "en"]);
    expect(VIEWPORTS).toEqual([
      { width: 1280, height: 800 },
      { width: 800, height: 600 },
    ]);
  });
  test("e2e acoes: each language trusts its own versioned action, untouched by the other run", () => {
    expect(Object.keys(ACOES_ACTION)).toEqual([...LANGUAGES]);
    expect(new Set(Object.values(ACOES_ACTION)).size).toBe(LANGUAGES.length);
  });
});
