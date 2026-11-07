import { describe, expect, test } from "bun:test";
import { mergeHostCsv } from "../src/lib/costs-csv.ts";

const HEADER = "day,project_key,model,origin,cost_usd";

// Issue #126, slice 3: the Costs export across hosts is one file with a host column.
describe("costs-csv: the exports of several hosts become one file with a host column", () => {
  test("the header gets host first, and each row its host's name", () => {
    const merged = mergeHostCsv([
      { host: "alfa", csv: `${HEADER}\n2026-10-01,kA,opus,app,1.000000\n` },
      { host: "beta", csv: `${HEADER}\n2026-10-01,kB,sonnet,terminal,2.500000\n` },
    ]);
    expect(merged).toBe(
      [
        `host,${HEADER}`,
        "alfa,2026-10-01,kA,opus,app,1.000000",
        "beta,2026-10-01,kB,sonnet,terminal,2.500000",
        "",
      ].join("\n"),
    );
  });

  test("a host name with a comma, a quote or a leading formula sign is quoted or marked", () => {
    const merged = mergeHostCsv([
      { host: 'a,"b"', csv: `${HEADER}\n2026-10-01,kA,opus,app,1\n` },
      { host: "=SUM(A1)", csv: `${HEADER}\n2026-10-01,kB,opus,app,2\n` },
    ]);
    const lines = merged.split("\n");
    expect(lines[1]).toBe('"a,""b""",2026-10-01,kA,opus,app,1');
    expect(lines[2]).toBe("'=SUM(A1),2026-10-01,kB,opus,app,2");
  });

  test("a field with a line break inside quotes stays one row", () => {
    const merged = mergeHostCsv([
      { host: "alfa", csv: `${HEADER}\n2026-10-01,"k\nA",opus,app,1\n2026-10-02,kC,opus,app,3\n` },
    ]);
    expect(merged).toBe(
      [
        `host,${HEADER}`,
        'alfa,2026-10-01,"k\nA",opus,app,1',
        "alfa,2026-10-02,kC,opus,app,3",
        "",
      ].join("\n"),
    );
  });

  test("a host with no rows adds nothing, and no host at all gives no file", () => {
    const merged = mergeHostCsv([
      { host: "alfa", csv: `${HEADER}\n` },
      { host: "beta", csv: `${HEADER}\n2026-10-01,kB,opus,app,2\n` },
    ]);
    expect(merged).toBe([`host,${HEADER}`, "beta,2026-10-01,kB,opus,app,2", ""].join("\n"));
    expect(mergeHostCsv([])).toBe("");
  });
});
