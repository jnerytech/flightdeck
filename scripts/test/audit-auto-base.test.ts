import { describe, expect, test } from "bun:test";
import { auditBase, runAudit } from "../lib/tdd-audit.ts";

const HEAD = "f".repeat(40);
const BASE = "b".repeat(40);

/** A fake git that answers by the first words of the call; anything else fails (null). */
function fakeGit(answers: Record<string, string | null>) {
  return (args: string[]) => {
    const key = args.join(" ");
    return key in answers ? answers[key] ?? null : null;
  };
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
      "describe --tags --abbrev=0 HEAD": "v0.36.2\n",
    });
    expect(auditBase(git)).toBe("v0.36.2");
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
      if (key === `log --reverse --format=%H%x1f%s ${BASE}..HEAD`) {
        return `1\x1ftest(a): t\n2\x1ffeat(a): f`;
      }
      if (args[0] === "ls-files") return "";
      return null;
    };
    expect(runAudit({ since: "auto", git, readFile: () => "" })).toEqual({
      code: 0,
      output: `TDD AUDIT OK\n  since ${BASE} (auto)`,
    });
  });

  test("runAudit with since auto and no base fails with a reason", () => {
    expect(runAudit({ since: "auto", git: () => null, readFile: () => "" })).toEqual({
      code: 2,
      output: "since auto: no merge-base with main and no tag to audit from",
    });
  });
});
