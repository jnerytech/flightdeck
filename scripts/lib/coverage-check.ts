export interface FileCoverage {
  /** [hit, found] */
  functions: [number, number];
  lines: [number, number];
}

const normalize = (path: string) => path.replaceAll("\\", "/");

/** Reads per-file function and line totals from an lcov report. */
export function parseLcov(text: string): Map<string, FileCoverage> {
  const files = new Map<string, FileCoverage>();
  let current: FileCoverage | null = null;
  for (const line of text.split(/\r?\n/)) {
    const [key, value = ""] = line.split(":", 2) as [string, string?];
    if (key === "SF") {
      current = { functions: [0, 0], lines: [0, 0] };
      files.set(normalize(line.slice(3)), current);
    } else if (current && key === "FNH") current.functions[0] = Number(value);
    else if (current && key === "FNF") current.functions[1] = Number(value);
    else if (current && key === "LH") current.lines[0] = Number(value);
    else if (current && key === "LF") current.lines[1] = Number(value);
  }
  return files;
}

/**
 * Lists every source file that is not fully covered, including files no test ever loads
 * (`bun test` only reports files that were imported, so those would otherwise slip through).
 */
export function checkCoverage(
  report: Map<string, FileCoverage>,
  sources: readonly string[],
): string[] {
  const problems: string[] = [];
  for (const source of sources.map(normalize)) {
    const file = report.get(source);
    if (!file) {
      problems.push(`${source}: nenhum teste carrega este arquivo`);
      continue;
    }
    const [fnHit, fnFound] = file.functions;
    const [lnHit, lnFound] = file.lines;
    if (fnHit < fnFound || lnHit < lnFound) {
      problems.push(`${source}: funções ${fnHit}/${fnFound}, linhas ${lnHit}/${lnFound}`);
    }
  }
  return problems;
}

/** False for type-only modules, which compile to nothing and so never show up in coverage. */
export function hasRuntimeCode(code: string, loader: "ts" | "tsx"): boolean {
  return new Bun.Transpiler({ loader }).transformSync(code).trim().length > 0;
}
