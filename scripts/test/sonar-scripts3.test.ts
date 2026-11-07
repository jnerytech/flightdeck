import { describe, expect, test } from "bun:test";
import { staticImports } from "../lib/bundle-reach.ts";

describe("sonar-scripts3: staticImports reads whitespace in the import pattern with the same matches", () => {
  test("any whitespace, newlines included, separates the keyword, the names, `from` and the source", () => {
    expect(staticImports('import\n{ a }\nfrom\n"./a.ts"')).toEqual(["./a.ts"]);
    expect(staticImports('import\ta\tfrom\t"./b.ts"')).toEqual(["./b.ts"]);
    expect(staticImports('export\r\n*\r\nfrom\r\n"./c.ts"')).toEqual(["./c.ts"]);
    expect(staticImports('import a,\n  b\n  from "./d.ts"')).toEqual(["./d.ts"]);
    expect(staticImports('import\n"./e.ts"')).toEqual(["./e.ts"]);
  });

  test("only spaces and tabs may indent the statement, and `type` needs whitespace after it", () => {
    expect(staticImports('\t \timport a from "./f.ts"')).toEqual(["./f.ts"]);
    expect(staticImports('x; import a from "./g.ts"')).toEqual([]);
    expect(staticImports('import type\n{ A } from "./h.ts"')).toEqual([]);
    expect(staticImports('import typeof from "./i.ts"')).toEqual(["./i.ts"]);
  });

  test("an import of only types is recognised across newlines and tabs, and a value among them loads", () => {
    expect(staticImports('import {\n\ttype A\n\t,\n\ttype B\n\tas\n\tC\n} from "./j.ts"')).toEqual(
      [],
    );
    expect(staticImports('import { type\tA\tas\tB } from "./k.ts"')).toEqual([]);
    expect(staticImports('import { type\nA, b } from "./l.ts"')).toEqual(["./l.ts"]);
    expect(staticImports('import { type A\n, type B\n,\n} from "./m.ts"')).toEqual([]);
  });

  test("a quote in the specifier is read up to the next quote of either kind", () => {
    expect(staticImports("import a from './n.ts'")).toEqual(["./n.ts"]);
    expect(staticImports('import a from "./o.ts"')).toEqual(["./o.ts"]);
    expect(staticImports('import "./p\'s.ts"')).toEqual(["./p"]);
  });
});
