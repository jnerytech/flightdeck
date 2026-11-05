import { describe, expect, test } from "bun:test";
import { issueRefs, type ReleaseCloseDeps, releaseClose } from "../lib/release-close.ts";

const R = "repos/{owner}/{repo}";

/** One commit of `git log --format=%s%x1f%b%x1e`. */
const commit = (subject: string, body = "") => `${subject}\x1f${body}\x1e`;

const LOG = [
  commit("fix(card-fields): a save never drops an edit (#170)"),
  commit("test(card-fields): a save never drops an edit (#170)"),
  commit("feat(sidebar-hosts): the hosts section keeps 7 rem (#171)"),
  commit("Merge pull request #166 from jnerytech/rc/0364"),
  commit("fix(persona-tools): one tool per click", "Closes #237\nThe overlay of #233 is deferred."),
  commit("docs(release): notes"),
].join("\n");

interface Issue {
  title: string;
  state: "open" | "closed";
  milestone?: { number: number; title: string };
  pull?: boolean;
  comments: string[];
}

const V364 = { number: 9, title: "v0.36.4" };

/** A fake GitHub behind `gh api`, and a fake git; every gh call is recorded. */
function fake(
  issues: Record<number, Issue>,
  opts: {
    milestoneOpen?: number;
    /** The milestone's state before the run (a second run finds it closed). */
    milestoneState?: "open" | "closed";
    fail?: RegExp;
    /** Calls answered with exit 0 and text that is not JSON. */
    garbage?: RegExp;
    board?: (n: number) => boolean;
    log?: string;
  } = {},
) {
  const calls: string[] = [];
  const lines: string[] = [];
  const boarded: number[] = [];
  const milestone = {
    ...V364,
    state: opts.milestoneState ?? "open",
    open_issues: opts.milestoneOpen ?? 0,
  };
  const field = (args: string[], name: string) =>
    args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
  const deps: ReleaseCloseDeps = {
    gh: async (args) => {
      const line = args.join(" ");
      calls.push(line);
      if (opts.garbage?.test(line)) return { code: 0, stdout: "<html>rate limited</html>" };
      if (opts.fail?.test(line)) return { code: 1, stdout: "" };
      const path = args.find((a) => a.startsWith("repos/")) ?? "";
      const method = args.includes("-X") ? args[args.indexOf("-X") + 1] : "GET";
      const m = /issues\/(\d+)(\/comments)?$/.exec(path);
      if (m) {
        const n = Number(m[1]);
        const issue = issues[n];
        if (!issue) return { code: 1, stdout: "" };
        if (m[2] && method === "POST") {
          issue.comments.push(field(args, "body") ?? "");
          return { code: 0, stdout: "{}" };
        }
        if (m[2]) return { code: 0, stdout: issue.comments.join("\n") };
        if (method === "PATCH") {
          issue.state = "closed";
          if (issue.milestone?.number === milestone.number) milestone.open_issues--;
          return { code: 0, stdout: "{}" };
        }
        return {
          code: 0,
          stdout: JSON.stringify({
            number: n,
            title: issue.title,
            state: issue.state,
            milestone: issue.milestone ?? null,
            ...(issue.pull ? { pull_request: { url: "x" } } : {}),
          }),
        };
      }
      if (path.startsWith(`${R}/milestones/`) && method === "PATCH") {
        milestone.state = "closed";
        return { code: 0, stdout: "{}" };
      }
      if (path.startsWith(`${R}/milestones`))
        return { code: 0, stdout: JSON.stringify([milestone]) };
      return { code: 1, stdout: "" };
    },
    git: async (args) => {
      if (args[0] === "rev-parse")
        return { code: args.includes("v9.9.9^{commit}") ? 1 : 0, stdout: "" };
      if (args[0] === "describe") return { code: 0, stdout: "v0.36.3\n" };
      if (args[0] === "log") return { code: 0, stdout: opts.log ?? LOG };
      return { code: 1, stdout: "" };
    },
    board: async (n) => {
      boarded.push(n);
      return opts.board ? opts.board(n) : true;
    },
    log: (line) => lines.push(line),
  };
  return {
    deps,
    calls,
    lines,
    boarded,
    milestone,
    writes: () => calls.filter((c) => c.includes("-X ")),
  };
}

const open = (title: string, milestone = V364): Issue => ({
  title,
  state: "open",
  milestone,
  comments: [],
});

describe("release-close", () => {
  test("a subject's #N and a Closes/Fixes/Resolves body line count; other body mentions do not", () => {
    expect(issueRefs(LOG)).toEqual({ closes: [166, 170, 171, 237], mentioned: [233] });
    expect(issueRefs(commit("chore: x", "fixes #12\nResolves #13\nsee #14 and #12"))).toEqual({
      closes: [12, 13],
      mentioned: [14],
    });
  });

  test("the dry run reads, says what it would do, and changes nothing", async () => {
    const f = fake({
      170: open("Card data loss"),
      171: { ...open("Hosts 0 px"), state: "closed" },
      166: { ...open("v0.36.3"), pull: true },
      237: open("Review fixes"),
      233: open("Taskbar badge"),
    });
    expect(await releaseClose("v0.36.4", { apply: false }, f.deps)).toBe(0);
    expect(f.writes()).toEqual([]);
    expect(f.boarded).toEqual([]);
    const out = f.lines.join("\n");
    expect(out).toContain("v0.36.3..v0.36.4");
    expect(out).toContain("#170 open: Card data loss → comment, close, board Done");
    expect(out).toContain("#171 closed: Hosts 0 px → board Done");
    expect(out).toContain("#166: a pull request, skipped");
    expect(out).toContain("mentioned only in commit bodies, not touched: #233");
    expect(out).toContain("milestone v0.36.4: closes once its last open issue is closed");
    expect(out).toContain("dry run: nothing changed (--apply to do it)");
    expect(f.calls.some((c) => c.includes("issues/233"))).toBe(false);
  });

  test("--apply comments, closes and boards each open issue, boards the closed one, and closes the empty milestone", async () => {
    const issues = {
      170: open("Card data loss"),
      171: { ...open("Hosts 0 px"), state: "closed" as const },
      166: { ...open("v0.36.3"), pull: true },
      237: open("Review fixes"),
      233: open("Taskbar badge"),
    };
    const f = fake(issues, { milestoneOpen: 2 });
    expect(await releaseClose("v0.36.4", { apply: true }, f.deps)).toBe(0);
    expect(f.writes()).toEqual([
      `api -X POST ${R}/issues/170/comments -f body=Shipped in v0.36.4.`,
      `api -X PATCH ${R}/issues/170 -f state=closed -f state_reason=completed`,
      `api -X POST ${R}/issues/237/comments -f body=Shipped in v0.36.4.`,
      `api -X PATCH ${R}/issues/237 -f state=closed -f state_reason=completed`,
      `api -X PATCH ${R}/milestones/9 -f state=closed`,
    ]);
    expect(f.boarded).toEqual([170, 171, 237]);
    expect(issues[233].state).toBe("open");
    expect(f.calls.some((c) => c.includes("issues/233"))).toBe(false);
    expect(f.milestone.state).toBe("closed");
  });

  test("a milestone with issues the tag did not ship stays open, and says how many", async () => {
    const f = fake(
      { 170: open("Card data loss"), 171: open("Hosts"), 237: open("Fixes") },
      {
        milestoneOpen: 5,
        log: commit("fix(x): y (#170)"),
      },
    );
    expect(await releaseClose("v0.36.4", { apply: true }, f.deps)).toBe(0);
    expect(f.milestone.state).toBe("open");
    expect(f.lines.join("\n")).toContain("milestone v0.36.4: 4 open issue(s) left, not closed");
    expect(f.writes().some((c) => c.includes("milestones"))).toBe(false);
  });

  test("a second run comments nothing twice and closes nothing twice", async () => {
    const issues = {
      170: { ...open("Card"), state: "closed" as const, comments: ["Shipped in v0.36.4."] },
    };
    // The first run closed the issue and the milestone.
    const f = fake(issues, { log: commit("fix(x): y (#170)"), milestoneState: "closed" });
    expect(await releaseClose("v0.36.4", { apply: true }, f.deps)).toBe(0);
    expect(f.writes()).toEqual([]);
    expect(f.boarded).toEqual([170]);
  });

  test("an open issue already commented is closed without a second comment", async () => {
    const issues = { 170: { ...open("Card"), comments: ["Shipped in v0.36.4."] } };
    const f = fake(issues, { log: commit("fix(x): y (#170)"), milestoneOpen: 2 });
    await releaseClose("v0.36.4", { apply: true }, f.deps);
    // One open issue is left in the milestone, so the only write is the close.
    expect(f.writes()).toEqual([
      `api -X PATCH ${R}/issues/170 -f state=closed -f state_reason=completed`,
    ]);
  });

  test("a failed call is named, the others go on, and the exit code is 1", async () => {
    const issues = { 170: open("Card"), 237: open("Fixes") };
    const f = fake(issues, { fail: /PATCH .*issues\/170/, board: (n) => n !== 237 });
    expect(await releaseClose("v0.36.4", { apply: true }, f.deps)).toBe(1);
    expect(issues[237].state).toBe("closed");
    const out = f.lines.join("\n");
    expect(out).toContain("#170: closing failed");
    expect(out).toContain("#237: board Done failed");
    expect(f.milestone.state).toBe("open");
  });

  test("an issue that cannot be read is named and fails the run, the rest still read", async () => {
    const f = fake(
      { 170: open("Card") },
      { log: commit("fix(x): y (#170)") + commit("fix(z): w (#404)") },
    );
    expect(await releaseClose("v0.36.4", { apply: false }, f.deps)).toBe(1);
    expect(f.lines.join("\n")).toContain("#404: cannot be read");
  });

  test("without a board command the board is skipped, and said once", async () => {
    const f = fake({ 170: open("Card") }, { log: commit("fix(x): y (#170)") });
    const { board: _board, ...noBoard } = f.deps;
    expect(await releaseClose("v0.36.4", { apply: true }, noBoard)).toBe(0);
    expect(f.lines.filter((l) => l.includes("board skipped"))).toHaveLength(1);
  });

  test("--since names the earlier tag; an unknown tag is the usage, exit 2", async () => {
    const f = fake({ 170: open("Card") }, { log: commit("fix(x): y (#170)") });
    await releaseClose("v0.36.4", { apply: false, since: "v0.36.1" }, f.deps);
    expect(f.lines.join("\n")).toContain("v0.36.1..v0.36.4");
    expect(await releaseClose("v9.9.9", { apply: false }, f.deps)).toBe(2);
  });

  test("a tag with no milestone of its name says so and closes nothing else", async () => {
    const f = fake({ 170: open("Card") }, { log: commit("fix(x): y (#170)") });
    expect(await releaseClose("v0.40.0", { apply: true }, f.deps)).toBe(0);
    expect(f.lines.join("\n")).toContain("no milestone named v0.40.0");
  });

  test("an answer that is not JSON is an issue that cannot be read", async () => {
    const f = fake(
      { 170: open("Card") },
      { log: commit("fix(x): y (#170)"), garbage: /issues\/170$/ },
    );
    expect(await releaseClose("v0.36.4", { apply: false }, f.deps)).toBe(1);
    expect(f.lines.join("\n")).toContain("#170: cannot be read");
  });

  test("a comment that fails leaves the issue open and off the board", async () => {
    const issues = { 170: open("Card") };
    const f = fake(issues, { log: commit("fix(x): y (#170)"), fail: /POST/ });
    expect(await releaseClose("v0.36.4", { apply: true }, f.deps)).toBe(1);
    expect(f.lines.join("\n")).toContain("#170: commenting failed");
    expect(issues[170].state).toBe("open");
    expect(f.boarded).toEqual([]);
  });

  test("the dry run counts the milestone's issues the tag does not ship", async () => {
    const f = fake({ 170: open("Card") }, { log: commit("fix(x): y (#170)"), milestoneOpen: 4 });
    await releaseClose("v0.36.4", { apply: false }, f.deps);
    expect(f.lines.join("\n")).toContain("milestone v0.36.4: 3 open issue(s) left, not closed");
  });

  test("a milestone that cannot be closed is named and fails the run", async () => {
    const f = fake(
      { 170: open("Card") },
      {
        log: commit("fix(x): y (#170)"),
        milestoneOpen: 1,
        fail: /milestones\/9/,
      },
    );
    expect(await releaseClose("v0.36.4", { apply: true }, f.deps)).toBe(1);
    expect(f.lines.join("\n")).toContain("milestone v0.36.4: closing failed");
  });

  test("a milestone closed already is said so, in the dry run and with --apply", async () => {
    const closed = { log: commit("fix(x): y (#170)"), milestoneState: "closed" as const };
    const dry = fake({ 170: open("Card") }, closed);
    await releaseClose("v0.36.4", { apply: false }, dry.deps);
    expect(dry.lines.join("\n")).toContain("milestone v0.36.4: already closed");
    const applied = fake({ 170: open("Card") }, closed);
    await releaseClose("v0.36.4", { apply: true }, applied.deps);
    expect(applied.lines.join("\n")).toContain("milestone v0.36.4: already closed");
  });
});
