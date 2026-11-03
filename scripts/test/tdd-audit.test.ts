import { describe, expect, test } from "bun:test";
import {
  auditCommits,
  findForbiddenMarkers,
  parseCommits,
  parseWaivers,
  runAudit,
} from "../lib/tdd-audit.ts";

// Built by concatenation so this very file never contains the forbidden markers.
const ONLY = `.${"only"}(`;
const SKIP = `.${"skip"}(`;
const TODO = `test.${"todo"}(`;

const log = (...subjects: string[]) =>
  subjects.map((s, i) => `${String(i).padStart(7, "0")}\x1f${s}`).join("\n");

describe("tdd-audit", () => {
  test("parseCommits lê tipo, escopo e ignora assuntos fora do padrão", () => {
    expect(
      parseCommits(
        log(
          "feat(unit-systemd): gera unit",
          "fix(redes)!: corrige",
          "Merge branch x",
          "docs: readme",
        ),
      ),
    ).toEqual([
      {
        hash: "0000000",
        subject: "feat(unit-systemd): gera unit",
        type: "feat",
        scope: "unit-systemd",
      },
      { hash: "0000001", subject: "fix(redes)!: corrige", type: "fix", scope: "redes" },
      { hash: "0000002", subject: "Merge branch x", type: null, scope: null },
      { hash: "0000003", subject: "docs: readme", type: "docs", scope: null },
    ]);
    expect(parseCommits("")).toEqual([]);
  });

  test("feat sem test anterior do mesmo escopo é violação", () => {
    const violations = auditCommits(parseCommits(log("test(a): x", "feat(b): y")));
    expect(violations).toEqual([
      { commit: "0000001", scope: "b", reason: "feat sem commit test(b) anterior" },
    ]);
  });

  test("test antes de feat passa; test depois do feat não conta", () => {
    expect(auditCommits(parseCommits(log("test(a): x", "feat(a): y", "fix(a): z")))).toEqual([]);
    expect(auditCommits(parseCommits(log("feat(a): y", "test(a): x")))).toEqual([
      { commit: "0000000", scope: "a", reason: "feat sem commit test(a) anterior" },
    ]);
  });

  test("fix também exige teste; feat sem escopo é violação; tipos isentos passam", () => {
    expect(
      auditCommits(
        parseCommits(
          log(
            "fix(c): bug",
            "feat: algo",
            "docs: x",
            "chore(c): y",
            "build: z",
            "ci: w",
            "refactor(d): r",
          ),
        ),
      ),
    ).toEqual([
      { commit: "0000000", scope: "c", reason: "fix sem commit test(c) anterior" },
      { commit: "0000001", scope: "-", reason: "feat sem escopo" },
    ]);
  });

  test(".only, .skip e test.todo são detectados com arquivo e linha", () => {
    const files = [
      { path: "a.test.ts", content: `describe("x", () => {\n  test${ONLY}"y", () => {});\n});` },
      { path: "b.test.tsx", content: `describe${SKIP}"z", () => {});\n${TODO}"w");` },
      { path: "c.test.ts", content: `test("ok", () => {});` },
    ];
    expect(findForbiddenMarkers(files)).toEqual([
      { commit: "a.test.ts:2", scope: "-", reason: `uso proibido de ${ONLY}` },
      { commit: "b.test.tsx:1", scope: "-", reason: `uso proibido de ${SKIP}` },
      { commit: "b.test.tsx:2", scope: "-", reason: `uso proibido de ${TODO}` },
    ]);
  });

  test("runAudit imprime TDD AUDIT OK sem violações e lista as violações com código 1", () => {
    const git = (subjects: string[]) => (args: string[]) => {
      if (args[0] === "rev-parse") return args[2] === "fase-1^{commit}" ? "abc" : null;
      if (args[0] === "log") return log(...subjects);
      return "x.test.ts\n";
    };
    const clean = runAudit({
      since: "fase-1",
      git: git(["test(a): t", "feat(a): f"]),
      readFile: () => "",
    });
    expect(clean).toEqual({ code: 0, output: "TDD AUDIT OK" });

    const dirty = runAudit({
      since: "fase-1",
      git: git(["feat(a): f"]),
      readFile: () => `it${ONLY}"x")`,
    });
    expect(dirty.code).toBe(1);
    expect(dirty.output).toBe(
      [
        "TDD AUDIT FAIL: 2 violação(ões)",
        "  0000000  a  feat sem commit test(a) anterior",
        `  x.test.ts:1  -  uso proibido de ${ONLY}`,
      ].join("\n"),
    );

    const noTag = runAudit({ since: "nao-existe", git: git([]), readFile: () => "" });
    expect(noTag).toEqual({ code: 2, output: "tag ou commit desconhecido: nao-existe" });
  });

  describe("waivers", () => {
    const HASH_A = "a".repeat(40);
    const HASH_B = "b".repeat(40);
    const run = (subjects: string[], hashes: string[], waivers: object[]) =>
      runAudit({
        since: "fase-1",
        waivers: waivers as never,
        git: (args) => {
          if (args[0] === "rev-parse") return "abc";
          if (args[0] === "log") {
            return subjects.map((s, i) => `${hashes[i]}\x1f${s}`).join("\n");
          }
          return "";
        },
        readFile: () => "",
      });

    test("parseWaivers reads hash, scope and reason, and rejects anything malformed", () => {
      const ok = { hash: HASH_A, scope: "a", reason: "made during the rc merge" };
      expect(parseWaivers(JSON.stringify([ok]))).toEqual([ok]);
      expect(parseWaivers("[]")).toEqual([]);
      expect(() => parseWaivers("{}")).toThrow("array");
      expect(() => parseWaivers(JSON.stringify([{ ...ok, hash: "abc1234" }]))).toThrow("40");
      expect(() => parseWaivers(JSON.stringify([{ ...ok, reason: " " }]))).toThrow("reason");
      expect(() => parseWaivers(JSON.stringify([{ ...ok, scope: "" }]))).toThrow("scope");
    });

    test("a waived violation passes and is printed, so it stays visible", () => {
      const result = run(
        ["fix(a): f"],
        [HASH_A],
        [{ hash: HASH_A, scope: "a", reason: "rc merge" }],
      );
      expect(result).toEqual({
        code: 0,
        output: ["TDD AUDIT OK (1 waived)", `  waived  ${HASH_A}  a  rc merge`].join("\n"),
      });
    });

    test("a waiver matches the full hash and the scope only", () => {
      const abbreviated = run(
        ["fix(a): f"],
        [HASH_A],
        [{ hash: HASH_A.slice(0, 7), scope: "a", reason: "r" }],
      );
      expect(abbreviated.code).toBe(1);
      const otherScope = run(["fix(a): f"], [HASH_A], [{ hash: HASH_A, scope: "b", reason: "r" }]);
      expect(otherScope.code).toBe(1);
      expect(otherScope.output).toContain(`  ${HASH_A}  a  fix sem commit test(a) anterior`);
    });

    test("a waiver for a commit inside the range that is not a violation is stale and fails", () => {
      const needless = run(
        ["test(a): t", "feat(a): f"],
        [HASH_A, HASH_B],
        [{ hash: HASH_B, scope: "a", reason: "r" }],
      );
      expect(needless.code).toBe(1);
      expect(needless.output).toContain(
        `  ${HASH_B}  a  stale waiver: the commit is in the audited range and is not a violation`,
      );
    });

    test("a waiver for a commit outside the range is ignored and shown as a note", () => {
      const outside = run(
        ["test(a): t", "feat(a): f"],
        [HASH_A, HASH_B],
        [{ hash: "c".repeat(40), scope: "a", reason: "r" }],
      );
      expect(outside).toEqual({
        code: 0,
        output: ["TDD AUDIT OK", `  ignored  ${"c".repeat(40)}  a  outside the audited range`].join(
          "\n",
        ),
      });
    });

    test("a failing audit still prints the waived commits", () => {
      const result = run(
        ["fix(a): f", "fix(b): g"],
        [HASH_A, HASH_B],
        [{ hash: HASH_A, scope: "a", reason: "rc merge" }],
      );
      expect(result.code).toBe(1);
      expect(result.output).toBe(
        [
          "TDD AUDIT FAIL: 1 violação(ões)",
          `  ${HASH_B}  b  fix sem commit test(b) anterior`,
          "1 waived:",
          `  waived  ${HASH_A}  a  rc merge`,
        ].join("\n"),
      );
    });
  });
});
