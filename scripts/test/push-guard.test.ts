import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { pushViolation } from "../lib/claude-hooks.ts";

const CWD = "/repos/flightdeck-fix";

/** A checkout on branch `current` (null: detached) with these local tags. */
function checkout(current: string | null, tags: string[] = ["v0.36.2"], dir = CWD) {
  const calls: string[] = [];
  return {
    calls,
    env: {} as Record<string, string | undefined>,
    git: (args: string[], cwd: string) => {
      calls.push(`${cwd}: ${args.join(" ")}`);
      if (cwd !== dir) return null;
      const key = args.join(" ");
      if (key === "symbolic-ref --short HEAD") return current ? `${current}\n` : null;
      const tag = /^show-ref --verify --quiet refs\/tags\/(.+)$/.exec(key)?.[1];
      if (tag !== undefined) return tags.includes(tag) ? "" : null;
      return null;
    },
  };
}

const push = (command: string, current: string | null = "fix-x") =>
  pushViolation(command, CWD, checkout(current));

describe("push-guard", () => {
  test("main, an rc branch and tags are blocked, however they are named", () => {
    for (const command of [
      "git push origin main",
      "git push origin HEAD:main",
      "git push origin fix-x:refs/heads/main",
      "git push origin rc/0363",
      "git push origin HEAD:rc/0364",
      "git push origin v0.36.2",
      "git push origin refs/tags/v0.37.0",
      "git push origin --delete main",
      "git push origin :rc/0363",
    ]) {
      const reason = push(command) ?? "";
      expect(`${command} -> ${reason.includes("is blocked")}`).toBe(`${command} -> true`);
      expect(reason).toContain("only their own work branches");
    }
  });

  test("a push with no refspec pushes the current branch: blocked on main or rc/*", () => {
    expect(push("git push", "main") ?? "").toContain("is blocked");
    expect(push("git push -u origin HEAD", "rc/0363") ?? "").toContain("is blocked");
  });

  test("--tags, --all and --mirror are blocked", () => {
    for (const command of [
      "git push --tags",
      "git push origin --tags",
      "git push --all origin",
      "git push --mirror",
    ]) {
      expect(push(command) ?? "").toContain("is blocked");
    }
  });

  test("a bare --force or a + refspec is blocked; --force-with-lease only to the branch checked out", () => {
    expect(push("git push --force origin fix-x") ?? "").toContain("--force-with-lease");
    expect(push("git push -f") ?? "").toContain("--force-with-lease");
    expect(push("git push origin +fix-x") ?? "").toContain("--force-with-lease");
    expect(push("git push --force-with-lease origin other-branch") ?? "").toContain("is blocked");
    expect(push("git push --force-with-lease origin fix-x")).toBeNull();
    expect(push("git push --force-with-lease")).toBeNull();
  });

  test("a session's own work branch passes", () => {
    for (const command of [
      "git push",
      "git push -u origin fix-x",
      "git push origin HEAD",
      "git push origin fix-x:fix-x",
      "git push origin HEAD:refs/heads/fix-x",
      "git push --set-upstream origin harness-push-guard",
    ]) {
      expect(`${command} -> ${push(command)}`).toBe(`${command} -> null`);
    }
  });

  test("the push runs where the command points (cd, git -C)", () => {
    // Resolved as the guard resolves it, so the case holds on Windows too.
    const rc = resolve("/repos/flightdeck-rc0363");
    const wt = checkout("rc/0363", [], rc);
    expect(pushViolation(`cd ${rc} && git push`, CWD, wt) ?? "").toContain("is blocked");
    expect(pushViolation(`git -C ${rc} push`, CWD, wt) ?? "").toContain("is blocked");
  });

  test("the coordinator, another repository and commands that push nothing pass", () => {
    const coordinator = { ...checkout("main"), env: { FLIGHTDECK_COORDINATOR: "1" } };
    expect(pushViolation("git push origin main --tags", CWD, coordinator)).toBeNull();
    const foreign = { ...checkout("main"), inProject: () => false };
    expect(pushViolation("git push origin main", CWD, foreign)).toBeNull();
    const quiet = checkout("main");
    expect(
      pushViolation('git log --oneline && echo "git push origin main"', CWD, quiet),
    ).toBeNull();
    expect(quiet.calls).toEqual([]);
  });
});
