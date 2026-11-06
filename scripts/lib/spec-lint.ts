/**
 * The shape of a phase spec (issue #169, D3): the sections of docs/templates/SPEC.md in order,
 * and an area table whose test files follow docs/TDD.md, so the spec-verifier and
 * `tdd:audit --spec` can read it. It applies to phase 40 on (and to a spec carrying
 * `<!-- spec-lint -->`); the older specs keep their own shapes.
 */

/** The `##` sections every linted spec has, in this order; others may sit between them. */
export const SECTIONS = [
  "Goal",
  "Non-goals",
  "Proof of concept first",
  "Design",
  "Protocol, migration and rollback",
  "Acceptance scenarios",
  "Tests and criteria",
  "Risks",
  "Acceptance criteria",
  "Real checks",
];

export interface SpecArea {
  area: string;
  testFile: string;
  /** 1-based line of the row. */
  line: number;
}

const TITLE = /^# Flightdeck — Phase (?:N|\d+) spec \(.+\)$/;
const HEADER = "| Area | Test file | What must pass |";
const AREA = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEST_FILE =
  /^(?:apps\/[\w-]+\/test|packages\/[\w-]+\/test|scripts\/test)\/([\w.-]+)\.test\.tsx?$/;
const SMOKE = /^scripts\/smoke-[\w-]+\.ts$/;
const FEATURE = /^scripts\/e2e\/bdd\/features\/[\w-]+\.feature$/;
/** The Rust side: a module's own tests, or an integration test; Rust names files with `_`. */
const RUST = /^apps\/desktop\/src-tauri\/(?:src|tests)\/[\w/]+\.rs$/;

/** The lines of each `##` section outside fenced code, with the line number of each. */
function sections(text: string): { name: string; lines: { line: string; n: number }[] }[] {
  const out: { name: string; lines: { line: string; n: number }[] }[] = [];
  let fenced = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? undefined : /^## (.+?)\s*$/.exec(line)?.[1];
    if (heading !== undefined) out.push({ name: heading, lines: [] });
    else out.at(-1)?.lines.push({ line, n: i + 1 });
  });
  return out;
}

const unquote = (cell: string) => cell.trim().replace(/^`(.*)`$/, "$1");

/** The rows of the spec's area table. */
export function specAreas(text: string): SpecArea[] {
  const lines = sections(text).find((s) => s.name === "Tests and criteria")?.lines ?? [];
  const header = lines.findIndex(({ line }) => line.trim() === HEADER);
  if (header < 0) return [];
  const rows: SpecArea[] = [];
  for (const { line, n } of lines.slice(header + 2)) {
    if (!line.trim().startsWith("|")) break;
    const [area = "", testFile = ""] = line.split("|").slice(1).map(unquote);
    rows.push({ area, testFile, line: n });
  }
  return rows;
}

/** What is wrong with one row of the area table, or null. */
function rowProblem({ area, testFile, line }: SpecArea): string | null {
  if (!AREA.test(area)) return `line ${line}: \`${area}\` is not kebab-case`;
  const test = TEST_FILE.exec(testFile);
  if (!test && !SMOKE.test(testFile) && !FEATURE.test(testFile) && !RUST.test(testFile)) {
    return `line ${line}: ${testFile} is not a test file (apps/*/test, packages/*/test, scripts/test, src-tauri, a smoke or a .feature)`;
  }
  if (test && test[1] !== area)
    return `line ${line}: the test file of \`${area}\` is ${area}.test.ts(x)`;
  if (area.endsWith("-ui") && !testFile.startsWith("apps/desktop/test/")) {
    return `line ${line}: a -ui area is tested in apps/desktop/test/`;
  }
  return null;
}

/** What is wrong with the spec, one line each, or [] when it has the shape. */
export function lintSpec(text: string): string[] {
  const problems: string[] = [];
  if (!TITLE.test(text.split("\n")[0] ?? "")) {
    problems.push("line 1: the title is `# Flightdeck — Phase N spec (<theme>)`");
  }
  const found = sections(text);
  let at = 0;
  SECTIONS.forEach((name, i) => {
    const index = found.findIndex((s, k) => k >= at && s.name === name);
    if (index < 0) {
      const after = i > 0 ? ` (after ## ${SECTIONS[i - 1]})` : "";
      problems.push(`missing section: ## ${name}${after}`);
    } else at = index + 1;
  });
  const tests = found.find((s) => s.name === "Tests and criteria");
  if (tests && !tests.lines.some(({ line }) => line.trim() === HEADER)) {
    problems.push(`Tests and criteria: the table needs the columns ${HEADER}`);
  }
  for (const row of specAreas(text)) {
    const problem = rowProblem(row);
    if (problem) problems.push(problem);
  }
  const scenarios = found.find((s) => s.name === "Acceptance scenarios");
  if (scenarios) {
    const body = scenarios.lines.map(({ line }) => line).join("\n");
    const features = (body.match(/^\s*Feature:/gm) ?? []).length;
    const named = (body.match(/scripts\/e2e\/bdd\/features\/[\w-]+\.feature/g) ?? []).length;
    if (features > named) {
      problems.push(
        `Acceptance scenarios: ${features} Feature but ${named} scripts/e2e/bdd/features/*.feature named`,
      );
    }
  }
  return problems;
}

/** Whether a spec is held to the shape: phase 40 on, or one that asks for it. */
export function linted(path: string, text: string): boolean {
  const phase = /SPEC-fase-(\d+)\.md$/.exec(path)?.[1];
  return (phase !== undefined && Number(phase) >= 40) || text.includes("<!-- spec-lint -->");
}
