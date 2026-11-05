import { describe, expect, test } from "bun:test";
import { auditBase, runAudit } from "../lib/tdd-audit.ts";

const HEAD = "f".repeat(40);
const BASE = "b".repeat(40);

/** A fake git that answers by the whole call; anything else fails (null). */
function fakeGit(answers: Record<string, string>) {
  return (args: string[]) => answers[args.join(" ")] ?? null;
}

describe("audit-auto-base", () => {
  test("on a branch, the base is the merge-base with origin/main", () => {
    const git = fakeGit({
      "rev-parse HEAD": `${HEAD}\n`,
      "merge-base HEAD origin/main": `${BASE}\n`,
    });
    expect(auditBase(git)).toBe(BASE);
  });

  test("without origin/main, the local main is used", () => {
    const git = fakeGit({
      "rev-parse HEAD": `${HEAD}\n`,
      "merge-base HEAD main": `${BASE}\n`,
    });
    expect(auditBase(git)).toBe(BASE);
  });

  test("on main itself (the merge-base is HEAD), the base is the last tag", () => {
    const git = fakeGit({
      "rev-parse HEAD": `${HEAD}\n`,
      "merge-base HEAD origin/main": `${HEAD}\n`,
      "describe --tags --abbrev=0 --match v[0-9]* HEAD": "v0.36.2\n",
    });
    expect(auditBase(git)).toBe("v0.36.2");
  });

  test("on a local main with commits not pushed yet, the base is still the last release tag", () => {
    const git = fakeGit({
      "rev-parse HEAD": `${HEAD}\n`,
      "symbolic-ref --short HEAD": "main\n",
      "merge-base HEAD origin/main": `${BASE}\n`,
      "describe --tags --abbrev=0 --match v[0-9]* HEAD": "v0.36.2\n",
    });
    expect(auditBase(git)).toBe("v0.36.2");
  });

  test("a phase tag (fase-N) is never the base: only release tags v* count", () => {
    const git = fakeGit({
      "rev-parse HEAD": `${HEAD}\n`,
      "merge-base HEAD origin/main": `${HEAD}\n`,
      "describe --tags --abbrev=0 HEAD": "fase-39\n",
    });
    expect(auditBase(git)).toBeNull();
  });

  test("no main and no tag gives no base", () => {
    expect(auditBase(fakeGit({ "rev-parse HEAD": `${HEAD}\n` }))).toBeNull();
    expect(
      auditBase(
        fakeGit({ "rev-parse HEAD": `${HEAD}\n`, "merge-base HEAD origin/main": `${HEAD}\n` }),
      ),
    ).toBeNull();
    expect(auditBase(fakeGit({}))).toBeNull();
  });

  test("runAudit with since auto audits from the base and names it", () => {
    const git = (args: string[]) => {
      const key = args.join(" ");
      if (key === "rev-parse HEAD") return `${HEAD}\n`;
      if (key === "merge-base HEAD origin/main") return `${BASE}\n`;
      if (key === `rev-parse --verify ${BASE}^{commit}`) return `${BASE}\n`;
      if (args[0] === "log" && args.at(-1) === `${BASE}..HEAD`) {
        return `1\x1ftest(a): t\n2\x1ffeat(b): f`;
      }
      if (args[0] === "ls-files") return "";
      return null;
    };
    // feat(b) has no test(b): the failure proves the commits came from BASE..HEAD.
    expect(runAudit({ since: "auto", git, readFile: () => "" })).toEqual({
      code: 1,
      output: `TDD AUDIT FAIL: 1 violação(ões)\n  since ${BASE} (auto)\n  2  b  feat sem commit test(b) anterior`,
    });
  });

  test("runAudit with since auto and no base fails with a reason", () => {
    expect(runAudit({ since: "auto", git: () => null, readFile: () => "" })).toEqual({
      code: 2,
      output: "since auto: no merge-base with main and no tag to audit from",
    });
  });
});
