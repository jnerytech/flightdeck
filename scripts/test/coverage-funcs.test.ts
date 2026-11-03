import { afterEach, describe, expect, test } from "bun:test";
import {
  formatReport,
  HOOK,
  hitRecorder,
  instrument,
  loadBabel,
  onLoadFor,
  PRELOAD,
  parseHits,
  planCoverageFuncs,
  siteKey,
  uncalled,
} from "../lib/coverage-funcs.ts";

const babel = loadBabel();
const transpiler = new Bun.Transpiler({ loader: "ts" });

/** Instruments `source`, runs its `main()` and returns the keys of the markers that fired. */
function run(source: string): { hits: string[]; result: unknown; keys: string[] } {
  const { code, sites } = instrument(source, "x.ts", babel);
  const hits: string[] = [];
  (globalThis as Record<string, unknown>)[HOOK] = (key: string) => hits.push(key);
  const result = new Function(`${transpiler.transformSync(code)}\nreturn main();`)();
  return { hits, result, keys: sites.map(siteKey) };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[HOOK];
});

describe("siteKey", () => {
  test("joins file, line and column", () => {
    expect(siteKey({ file: "a/b.ts", line: 3, column: 7 })).toBe("a/b.ts:3:7");
  });
});

describe("loadBabel", () => {
  test("gives Playwright's parser and traverser", () => {
    expect(typeof babel.babelParse).toBe("function");
    expect(typeof babel.traverse).toBe("function");
  });
});

describe("instrument", () => {
  test("marks a function declaration at the start of its block body", () => {
    const { code, sites } = instrument("function f() { return 1; }", "x.ts", babel);
    expect(sites).toEqual([{ file: "x.ts", line: 1, column: 0 }]);
    expect(code).toBe(`function f() {globalThis.${HOOK}?.("x.ts:1:0"); return 1; }`);
  });

  test("a marker fires when the function runs, and leaves the result alone", () => {
    const { hits, result, keys } = run(
      "function helper(a: number): number { return a + 1; }\nfunction main() { return helper(1); }",
    );
    expect(result).toBe(2);
    expect(keys).toEqual(["x.ts:1:0", "x.ts:2:0"]);
    expect(hits).toEqual(["x.ts:2:0", "x.ts:1:0"]);
  });

  test("a function that never runs leaves no hit", () => {
    const { hits } = run("function dead() { return 1; }\nfunction main() { return 0; }");
    expect(hits).toEqual(["x.ts:2:0"]);
  });

  test("an arrow with an expression body keeps its value", () => {
    const { result, hits } = run(
      "function main() { const f = (a: number) => a * 2; return f(4); }",
    );
    expect(result).toBe(8);
    expect(hits).toEqual(["x.ts:1:0", "x.ts:1:28"]);
  });

  test("an arrow that returns an object literal in parentheses stays valid", () => {
    const { result } = run("function main() { const f = (a: number) => ({ a }); return f(5); }");
    expect(result).toEqual({ a: 5 });
  });

  test("nested expression arrows that end together stay valid", () => {
    const { result } = run(
      "function main() { const f = (a: number) => (b: number) => (c: number) => a + b + c; return f(1)(2)(3); }",
    );
    expect(result).toBe(6);
  });

  test("an arrow whose expression body is a sequence or a cast stays valid", () => {
    const { result } = run(
      "function main() { const f = (a: number) => (a, a + 1); const g = (x: unknown) => x as number; return f(1) + g(2); }",
    );
    expect(result).toBe(4);
  });

  test("marks methods, constructors, accessors and object methods", () => {
    const { keys, hits, result } = run(
      [
        "class A {",
        "  v = 1;",
        "  constructor(public w: number) { }",
        "  get g() { return this.v; }",
        "  static s() { return 3; }",
        "  async *gen() { yield 1; }",
        "  #p() { return 4; }",
        "  callP() { return this.#p(); }",
        "}",
        "function main() {",
        "  const o = { m() { return 5; } };",
        "  const a = new A(2);",
        "  return a.g + A.s() + o.m() + a.callP();",
        "}",
      ].join("\n"),
    );
    expect(result).toBe(1 + 3 + 5 + 4);
    expect(keys).toEqual([
      "x.ts:3:2",
      "x.ts:4:2",
      "x.ts:5:2",
      "x.ts:6:2",
      "x.ts:7:2",
      "x.ts:8:2",
      "x.ts:10:0",
      "x.ts:11:14",
    ]);
    expect(hits).not.toContain("x.ts:6:2");
  });

  test("a marker goes after a directive prologue, so the directive still counts", () => {
    const { code } = instrument('function f() { "use strict"; return 1; }', "x.ts", babel);
    expect(code).toBe(`function f() { "use strict";globalThis.${HOOK}?.("x.ts:1:0"); return 1; }`);
  });

  test("overloads and abstract members have no body and no site", () => {
    const { sites } = instrument(
      "function f(a: string): string;\nfunction f(a: number): number;\nfunction f(a: any) { return a; }\nabstract class B { abstract m(): void; }",
      "x.ts",
      babel,
    );
    expect(sites.map(siteKey)).toEqual(["x.ts:3:0"]);
  });

  test("parses tsx when the file is a tsx file", () => {
    const { sites } = instrument("const C = () => <div />;", "c.tsx", babel);
    expect(sites.map(siteKey)).toEqual(["c.tsx:1:10"]);
  });

  test("source without functions comes back unchanged", () => {
    expect(instrument("export const a = 1;", "x.ts", babel)).toEqual({
      code: "export const a = 1;",
      sites: [],
    });
  });
});

describe("hitRecorder", () => {
  test("appends each key once", () => {
    const lines: string[] = [];
    const hit = hitRecorder((line) => lines.push(line));
    hit("a:1:0");
    hit("b:2:0");
    hit("a:1:0");
    expect(lines).toEqual(["a:1:0", "b:2:0"]);
  });

  test("a failing append does not break the code under test", () => {
    const hit = hitRecorder(() => {
      throw new Error("disk full");
    });
    expect(() => hit("a:1:0")).not.toThrow();
  });
});

describe("parseHits", () => {
  test("reads one key per line, ignoring blanks", () => {
    expect(parseHits("a:1:0\n\nb:2:3\r\na:1:0\n")).toEqual(new Set(["a:1:0", "b:2:3"]));
  });
});

describe("uncalled", () => {
  test("keeps the sites whose key is not in the hits", () => {
    const sites = [
      { file: "a.ts", line: 1, column: 0 },
      { file: "a.ts", line: 5, column: 2 },
    ];
    expect(uncalled(sites, new Set(["a.ts:1:0"]))).toEqual([{ file: "a.ts", line: 5, column: 2 }]);
  });
});

describe("formatReport", () => {
  const source = "export function a() {}\n\nexport const b = (x: number) => x * 2;\n";
  const sites = [
    { file: "m.ts", line: 1, column: 7 },
    { file: "m.ts", line: 3, column: 17 },
  ];

  test("lists each uncalled function as file:line with its source line", () => {
    const report = formatReport([{ file: "m.ts", source, sites }], new Set(["m.ts:1:7"]));
    expect(report).toBe(
      [
        "m.ts: 1 of 2 functions never called",
        "  m.ts:3  export const b = (x: number) => x * 2;",
      ].join("\n"),
    );
  });

  test("says so when every function was called, in the singular too", () => {
    expect(formatReport([{ file: "m.ts", source, sites }], new Set(sites.map(siteKey)))).toBe(
      "m.ts: all 2 functions called",
    );
    expect(
      formatReport(
        [
          {
            file: "n.ts",
            source: "export const n = () => 1;",
            sites: [{ file: "n.ts", line: 1, column: 17 }],
          },
        ],
        new Set(),
      ),
    ).toBe("n.ts: 1 of 1 function never called\n  n.ts:1  export const n = () => 1;");
  });

  test("says when a file has no functions", () => {
    expect(
      formatReport([{ file: "k.ts", source: "export const k = 1;", sites: [] }], new Set()),
    ).toBe("k.ts: no functions");
  });

  test("cuts a long source line", () => {
    const long = `export const f = () => "${"x".repeat(200)}";`;
    const report = formatReport(
      [{ file: "l.ts", source: long, sites: [{ file: "l.ts", line: 1, column: 17 }] }],
      new Set(),
    );
    expect(report.split("\n")[1]).toBe(`  l.ts:1  ${long.slice(0, 99)}…`);
  });

  test("joins several files", () => {
    const report = formatReport(
      [
        { file: "m.ts", source, sites },
        { file: "k.ts", source: "", sites: [] },
      ],
      new Set(sites.map(siteKey)),
    );
    expect(report).toBe("m.ts: all 2 functions called\nk.ts: no functions");
  });
});

describe("onLoadFor", () => {
  const files = ["apps/daemon/src/a.ts", "apps/desktop/src/c.tsx"];
  const read = (path: string) => (path.endsWith("a.ts") ? "function f() {}" : "const C = () => 1;");

  test("the filter takes the listed files, from any root and with either separator", () => {
    const { filter } = onLoadFor(files, babel, read);
    expect(filter.test("/repo/apps/daemon/src/a.ts")).toBe(true);
    expect(filter.test("C:\\repo\\apps\\desktop\\src\\c.tsx")).toBe(true);
    expect(filter.test("/repo/apps/daemon/src/b.ts")).toBe(false);
    expect(filter.test("/repo/apps/daemon/src/xa.ts")).toBe(false);
  });

  test("loads the instrumented text with the loader of the file", () => {
    const { load } = onLoadFor(files, babel, read);
    const ts = load("/repo/apps/daemon/src/a.ts");
    expect(ts?.loader).toBe("ts");
    expect(ts?.contents).toContain(`${HOOK}?.("apps/daemon/src/a.ts:1:0")`);
    const tsx = load("C:\\repo\\apps\\desktop\\src\\c.tsx");
    expect(tsx?.loader).toBe("tsx");
    expect(tsx?.contents).toContain(`${HOOK}?.("apps/desktop/src/c.tsx:1:10")`);
  });

  test("a file that is not listed is left to Bun", () => {
    expect(onLoadFor(files, babel, read).load("/repo/other.ts")).toBeUndefined();
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
  const deps = { platform: "linux" as const, git, readFile, log: "/tmp/hits.log" };

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

  test("runs the related tests with the preload, handing the files and the log over by env", () => {
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
      COVERAGE_FUNCS_LOG: "/tmp/hits.log",
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
