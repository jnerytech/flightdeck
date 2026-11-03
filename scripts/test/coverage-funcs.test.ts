import { afterEach, describe, expect, test } from "bun:test";
import {
  COVERAGE_VAR,
  createInstrumenter,
  type FunctionCoverage,
  formatReport,
  onLoadFor,
  PRELOAD,
  planCoverageFuncs,
  uncalled,
} from "../lib/coverage-funcs.ts";

const instrument = createInstrumenter();
const transpiler = new Bun.Transpiler({ loader: "ts" });
const store = globalThis as Record<string, unknown>;

/** Instruments `source`, runs its `main()` and returns the uncalled functions it left. */
function run(source: string, file = "x.ts") {
  const code = transpiler.transformSync(instrument(source, file));
  const result = new Function(`${code}\nreturn main();`)();
  const coverage = (store[COVERAGE_VAR] as Record<string, FunctionCoverage>)[
    file
  ] as FunctionCoverage;
  return { result, missed: uncalled(coverage) };
}

afterEach(() => {
  delete store[COVERAGE_VAR];
});

describe("createInstrumenter", () => {
  test("keeps the behaviour of TypeScript code and counts its functions", () => {
    const { result, missed } = run(
      [
        "class A {",
        "  v = 1;",
        "  constructor(public w: number) {}",
        "  get g(): number { return this.v; }",
        "  dead(): number { return 0; }",
        "}",
        "function helper<T>(a: T): T { return a; }",
        "function never() { return 1; }",
        "const arrow = (n: number) => ({ n });",
        "function main() {",
        "  const a = new A(2);",
        "  return [a.g, helper(2), arrow(3).n, a.w];",
        "}",
      ].join("\n"),
    );
    expect(result).toEqual([1, 2, 3, 2]);
    expect(missed.map((m) => m.line)).toEqual([5, 8]);
  });

  test("a generic arrow works in .ts and a component in .tsx", () => {
    expect(run("const id = <T>(a: T): T => a;\nfunction main() { return id(4); }").result).toBe(4);
    const tsx = instrument("const C = () => <div />;\nfunction main() { return 1; }", "c.tsx");
    expect(tsx).toContain(COVERAGE_VAR);
  });
});

describe("uncalled", () => {
  test("lists the functions with zero calls by line, with their names", () => {
    const coverage = {
      fnMap: {
        "0": { name: "late", line: 9 },
        "1": { name: "(anonymous_1)", line: 3 },
        "2": { name: "called", line: 5 },
      },
      f: { "0": 0, "1": 0, "2": 4 },
    };
    expect(uncalled(coverage)).toEqual([
      { line: 3, name: "(anonymous_1)" },
      { line: 9, name: "late" },
    ]);
  });
});

describe("formatReport", () => {
  const source = "function a() {}\n\nexport const b = (x: number) => x * 2;\nfunction named() {}\n";
  const fnMap = {
    "0": { name: "a", line: 1 },
    "1": { name: "(anonymous_1)", line: 3 },
    "2": { name: "named", line: 4 },
  };

  test("lists each uncalled function as file:line with its name, or its source line when anonymous", () => {
    const report = formatReport([{ file: "m.ts", source }], {
      "m.ts": { fnMap, f: { "0": 2, "1": 0, "2": 0 } },
    });
    expect(report).toBe(
      [
        "m.ts: 2 of 3 functions never called",
        "  m.ts:3  export const b = (x: number) => x * 2;",
        "  m.ts:4  named",
      ].join("\n"),
    );
  });

  test("says so when every function was called, and the singular", () => {
    expect(
      formatReport([{ file: "m.ts", source }], {
        "m.ts": { fnMap, f: { "0": 1, "1": 1, "2": 1 } },
      }),
    ).toBe("m.ts: all 3 functions called");
    expect(
      formatReport([{ file: "n.ts", source: "function n() {}" }], {
        "n.ts": { fnMap: { "0": { name: "n", line: 1 } }, f: { "0": 0 } },
      }),
    ).toBe("n.ts: 1 of 1 function never called\n  n.ts:1  n");
  });

  test("a file with no functions, and a file no test loaded", () => {
    const coverage = { "k.ts": { fnMap: {}, f: {} } };
    expect(formatReport([{ file: "k.ts", source: "" }], coverage)).toBe("k.ts: no functions");
    expect(formatReport([{ file: "z.ts", source: "" }], coverage)).toBe(
      "z.ts: no test loaded this file",
    );
  });

  test("cuts a long source line", () => {
    const long = `export const f = () => "${"x".repeat(200)}";`;
    const report = formatReport([{ file: "l.ts", source: long }], {
      "l.ts": { fnMap: { "0": { name: "(anonymous_0)", line: 1 } }, f: { "0": 0 } },
    });
    expect(report.split("\n")[1]).toBe(`  l.ts:1  ${long.slice(0, 99)}…`);
  });

  test("joins several files", () => {
    const report = formatReport(
      [
        { file: "m.ts", source },
        { file: "k.ts", source: "" },
      ],
      { "m.ts": { fnMap, f: { "0": 1, "1": 1, "2": 1 } }, "k.ts": { fnMap: {}, f: {} } },
    );
    expect(report).toBe("m.ts: all 3 functions called\nk.ts: no functions");
  });
});

describe("onLoadFor", () => {
  const files = ["apps/daemon/src/a.ts", "apps/desktop/src/c.tsx"];
  const read = (path: string) => (path.endsWith("a.ts") ? "function f() {}" : "const C = () => 1;");
  const fake = (code: string, file: string) => `/*${file}*/${code}`;

  test("the filter takes the listed files, from any root and with either separator", () => {
    const { filter } = onLoadFor(files, fake, read);
    expect(filter.test("/repo/apps/daemon/src/a.ts")).toBe(true);
    expect(filter.test("C:\\repo\\apps\\desktop\\src\\c.tsx")).toBe(true);
    expect(filter.test("/repo/apps/daemon/src/b.ts")).toBe(false);
    expect(filter.test("/repo/apps/daemon/src/xa.ts")).toBe(false);
  });

  test("loads the instrumented text, keyed by the listed path, with the loader of the file", () => {
    const { load } = onLoadFor(files, fake, read);
    expect(load("/repo/apps/daemon/src/a.ts")).toEqual({
      contents: "/*apps/daemon/src/a.ts*/function f() {}",
      loader: "ts",
    });
    expect(load("C:\\repo\\apps\\desktop\\src\\c.tsx")?.loader).toBe("tsx");
  });

  test("a file that is not listed is left to Bun", () => {
    expect(onLoadFor(files, fake, read).load("/repo/other.ts")).toBeUndefined();
  });
});

describe("planCoverageFuncs", () => {
  const tracked = {
    "apps/daemon/src/a.ts": "export const a = 1;",
    "apps/daemon/test/a.test.ts": 'import { a } from "../src/a.ts";',
    "apps/daemon/src/lonely.ts": "export const l = 1;",
  };
  const git = (args: string[]) =>
    args[0] === "ls-files" ? `${Object.keys(tracked).join("\n")}\n` : null;
  const readFile = (path: string) => tracked[path as keyof typeof tracked] as string;
  const deps = { platform: "linux" as const, git, readFile, out: "/tmp/cov.json" };

  test("without files it prints the usage and fails", () => {
    const plan = planCoverageFuncs({ ...deps, files: [] });
    expect(plan.code).toBe(2);
    expect(plan.output).toBe("usage: bun run coverage:funcs <file.ts>...");
    expect(plan.command).toBeNull();
  });

  test("a file that is not tracked is refused by name", () => {
    const plan = planCoverageFuncs({ ...deps, files: ["apps/daemon/src/a.ts", "nope.ts"] });
    expect(plan.code).toBe(2);
    expect(plan.output).toBe("coverage:funcs: not a tracked .ts or .tsx file: nope.ts");
    expect(plan.command).toBeNull();
  });

  test("a file no test reaches is reported and nothing runs", () => {
    const plan = planCoverageFuncs({ ...deps, files: ["apps/daemon/src/lonely.ts"] });
    expect(plan.code).toBe(0);
    expect(plan.output).toBe("coverage:funcs: no test file reaches apps/daemon/src/lonely.ts");
    expect(plan.command).toBeNull();
  });

  test("runs the related tests with the preload, handing the files and the output path over by env", () => {
    const plan = planCoverageFuncs({ ...deps, files: ["./apps/daemon/src/a.ts"] });
    expect(plan.code).toBe(0);
    expect(plan.output).toBe(
      "coverage:funcs: 1 test file(s) for 1 file(s)\n  apps/daemon/test/a.test.ts  imports apps/daemon/src/a.ts",
    );
    expect(plan.command).toEqual([
      "bun",
      "--config=bunfig.area.toml",
      "test",
      "--timeout=15000",
      "--preload",
      PRELOAD,
      "./apps/daemon/test/a.test.ts",
    ]);
    expect(plan.env).toEqual({
      COVERAGE_FUNCS_FILES: JSON.stringify(["apps/daemon/src/a.ts"]),
      COVERAGE_FUNCS_OUT: "/tmp/cov.json",
    });
  });

  test("many test files go through the slot", () => {
    const many: Record<string, string> = { "src/a.ts": "export const a = 1;" };
    for (let i = 0; i < 61; i += 1) many[`test/t${i}.test.ts`] = 'import "../src/a.ts";';
    const plan = planCoverageFuncs({
      ...deps,
      files: ["src/a.ts"],
      git: (args) => (args[0] === "ls-files" ? Object.keys(many).join("\n") : null),
      readFile: (path) => many[path] as string,
    });
    expect(plan.command?.slice(0, 4)).toEqual(["bun", "run", "slot", "--"]);
  });
});
