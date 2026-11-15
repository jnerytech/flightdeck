import type { CheckRun, Pr, PrFlowDeps } from "../../lib/pr/pr-flow.ts";

export const R = "repos/{owner}/{repo}";
export const REQUIRED = [
  "test (ubuntu-latest)",
  "test (windows-latest)",
  "screenshots (prints, axe e e2e)",
  "SonarCloud Code Analysis",
];
export const green = (): CheckRun[] =>
  REQUIRED.map((name, i) => ({ id: i + 1, name, status: "completed", conclusion: "success" }));

export interface FakePr extends Pr {
  state: "open" | "closed";
  /** GitHub's mergeable_state: "dirty" when the PR conflicts with its base. */
  mergeableState?: string;
  /** The head's repository (null: a deleted fork); absent, the same repository as the base. */
  headRepo?: string | null;
  /** What `gh api` prints for this PR in place of its JSON. */
  raw?: string;
}

/** A fake GitHub behind `gh api`, and a fake git; every write is recorded. */
export function fake(
  opts: {
    prs?: FakePr[];
    issues?: Record<number, string>;
    runs?: Record<string, CheckRun[]>;
    statuses?: Record<string, { context: string; state: string }[]>;
    behind?: Record<string, number>;
    subjects?: Record<string, string[]>;
    /** Subjects a merge of main brought into the branch: a plain log lists them after its own (oldest), a first-parent one does not (#2157). */
    mergedIn?: Record<string, string[]>;
    pushed?: string[];
    fail?: RegExp;
    env?: Record<string, string>;
    /** CI runs of a commit pushed to main, by SHA. */
    mainRuns?: Record<
      string,
      { id?: number; event?: string; status: string; conclusion: string | null }[]
    >;
    /** The jobs of a run, by run id. */
    runJobs?: Record<number, { name: string; conclusion: string | null }[]>;
    /** origin/main's HEAD and the commits on main. */
    mainHead?: string;
    onMain?: string[];
    tags?: string[];
    /** The first-parent commits of origin/main, newest first. */
    history?: string[];
    /** The version in apps/desktop/package.json at a commit of main, by SHA. */
    versions?: Record<string, string>;
    /** `gh run list` of a branch's PR runs, by branch (default "[]"); null: gh fails (#741). */
    prRuns?: Record<string, string | null>;
    /** `gh pr view <n> --json=mergeable,statusCheckRollup`, by PR number. */
    prViews?: Record<number, string>;
    /** The clock, in ms. */
    now?: number;
    /** The message GitHub's GraphQL answers with when it refuses. */
    graphqlError?: string;
    /** GitHub ignores the head filter and lists every open PR (#1115, seen 2026-11-08). */
    ignoreHead?: boolean;
    /** The review trailers of the branch's commits (#1707): the `Code-Review` and `Security-Review` values; default, both name "abc1234". */
    review?: { code?: string; security?: string };
    /** The tree of a named commit (default "head", the branch's head; "" is no commit); `head` sets the head's own tree. */
    trees?: Record<string, string>;
  } = {},
) {
  const prs = opts.prs ?? [];
  const writes: string[] = [];
  const gitWrites: string[] = [];
  const lines: string[] = [];
  /** The gh run list calls, in order (#741). */
  const asked: string[] = [];
  const ok = (stdout: string) => ({ code: 0, stdout });
  const deps: PrFlowDeps = {
    gh: async (args) => {
      const line = args.join(" ");
      if (opts.fail?.test(line)) return { code: 1, stdout: "" };
      if (args[0] === "run" && args[1] === "list") {
        asked.push(line);
        const branch = args.find((a) => a.startsWith("--branch="))?.slice("--branch=".length) ?? "";
        const listed = opts.prRuns?.[branch];
        return listed === null ? { code: 1, stdout: "" } : ok(listed ?? "[]");
      }
      if (args[0] === "pr" && args[1] === "view") {
        const view = opts.prViews?.[Number(args[2])];
        return ok(view ?? JSON.stringify({ mergeable: "MERGEABLE", statusCheckRollup: [] }));
      }
      if (args.includes("-X") || args[0] === "workflow") writes.push(line);
      if (args[0] === "workflow") return ok("");
      const path = args.find((a) => a.startsWith("repos/")) ?? "";
      if (path === `${R}/rules/branches/main`) {
        return ok(
          JSON.stringify([
            { type: "deletion" },
            {
              type: "required_status_checks",
              parameters: { required_status_checks: REQUIRED.map((context) => ({ context })) },
            },
          ]),
        );
      }
      if (path.startsWith(`${R}/pulls?head=`)) {
        const head = /head=\{owner\}:([^&]+)/.exec(path)?.[1];
        return ok(
          prs
            .filter((p) => (opts.ignoreHead || p.head === head) && p.state === "open")
            // As BRANCH_PR_JQ prints it: number, whether the head is this repository, head ref.
            .map((p) => `${p.number} ${p.headRepo === undefined} ${p.head}\n`)
            .join(""),
        );
      }
      if (path.startsWith(`${R}/pulls?state=open`)) {
        return ok(
          prs
            .filter((p) => p.state === "open")
            .map((p) => `${JSON.stringify({ ...p, state: undefined })}\n`)
            .join(""),
        );
      }
      if (path === `${R}/pulls` && args.includes("POST")) {
        const n = 300 + prs.length;
        return ok(`${n} https://github.com/o/r/pull/${n}\n`);
      }
      let m = /^repos\/\{owner\}\/\{repo\}\/pulls\/(\d+)(\/update-branch|\/merge)?$/.exec(path);
      if (m) {
        const pr = prs.find((p) => p.number === Number(m?.[1]));
        if (!pr) return { code: 1, stdout: "" };
        if (m[2]) return ok("{}");
        if (pr.raw !== undefined) return ok(pr.raw);
        return ok(
          JSON.stringify({
            number: pr.number,
            node_id: `PR_node${pr.number}`,
            title: pr.title,
            state: pr.state,
            draft: pr.draft,
            head: {
              ref: pr.head,
              sha: pr.sha,
              ...(pr.headRepo === undefined
                ? {}
                : { repo: pr.headRepo === null ? null : { full_name: pr.headRepo } }),
            },
            base: { ref: pr.base, repo: { full_name: "o/r" } },
            mergeable_state: pr.mergeableState ?? "clean",
          }),
        );
      }
      if (args.includes("graphql")) {
        if (opts.graphqlError)
          return { code: 1, stdout: JSON.stringify({ errors: [{ message: opts.graphqlError }] }) };
        return ok(`{"data":{"enablePullRequestAutoMerge":{"clientMutationId":null}}}`);
      }
      m = /commits\/(\w+)\/check-runs/.exec(path);
      if (m) {
        return ok((opts.runs?.[m[1] ?? ""] ?? []).map((r) => `${JSON.stringify(r)}\n`).join(""));
      }
      m = /commits\/(\w+)\/status$/.exec(path);
      if (m) {
        return ok(
          (opts.statuses?.[m[1] ?? ""] ?? []).map((s) => `${JSON.stringify(s)}\n`).join(""),
        );
      }
      m = /compare\/(.+)$/.exec(path);
      if (m) return ok(`${opts.behind?.[m[1] ?? ""] ?? 0}\n`);
      m = /issues\/(\d+)$/.exec(path);
      if (m) {
        const title = opts.issues?.[Number(m[1])];
        return title === undefined ? { code: 1, stdout: "" } : ok(`${title}\n`);
      }
      m = /actions\/workflows\/ci\.yml\/runs\?head_sha=(\w+)&branch=main$/.exec(path);
      if (m) {
        return ok(
          (opts.mainRuns?.[m[1] ?? ""] ?? []).map((r) => `${JSON.stringify(r)}\n`).join(""),
        );
      }
      // One page of up to 100 jobs: the default 30 could leave the suite's job unread (#444 review).
      m = /actions\/runs\/(\d+)\/jobs\?per_page=100$/.exec(path);
      if (m) {
        return ok(
          (opts.runJobs?.[Number(m[1])] ?? []).map((j) => `${JSON.stringify(j)}\n`).join(""),
        );
      }
      return { code: 1, stdout: "" };
    },
    git: async (args) => {
      if (args[0] === "tag" || args[0] === "push") {
        gitWrites.push(args.join(" "));
        return opts.fail?.test(args.join(" ")) ? { code: 1, stdout: "" } : ok("");
      }
      if (args[0] === "merge-base") {
        return { code: (opts.onMain ?? []).includes(args[2] ?? "") ? 0 : 1, stdout: "" };
      }
      if (args[0] === "rev-parse" && (args.at(-1) ?? "").startsWith("refs/tags/")) {
        const tag = (args.at(-1) ?? "").slice("refs/tags/".length);
        return { code: (opts.tags ?? []).includes(tag) ? 0 : 1, stdout: "" };
      }
      if (args[0] === "rev-list" && args.includes("--first-parent")) {
        return ok((opts.history ?? []).map((sha) => `${sha}\n`).join(""));
      }
      // The root package.json has no version: the product's lives in apps/desktop (#559).
      if (args[0] === "show" && (args.at(-1) ?? "").endsWith(":package.json")) {
        return ok(`${JSON.stringify({ name: "flightdeck", private: true })}\n`);
      }
      if (args[0] === "show" && (args.at(-1) ?? "").endsWith(":apps/desktop/package.json")) {
        const version = opts.versions?.[(args.at(-1) ?? "").split(":")[0] ?? ""];
        return version === undefined
          ? { code: 1, stdout: "" }
          : ok(`${JSON.stringify({ name: "@flightdeck/desktop", version })}\n`);
      }
      // The head's tree, and the tree of a named commit (nothing printed when it is no commit, #1707).
      if (args[0] === "rev-parse" && (args.at(-1) ?? "").endsWith("^{tree}")) {
        return ok(`${opts.trees?.head ?? "head"}\n`);
      }
      if (args[0] === "log" && args.includes("--end-of-options")) {
        const tree = opts.trees?.[args.at(-1) ?? ""] ?? "head";
        return ok(tree ? `${tree}\n` : "");
      }
      if (args[0] === "rev-parse" && args.at(-1) === "origin/main") {
        return opts.mainHead ? ok(`${opts.mainHead}\n`) : { code: 1, stdout: "" };
      }
      if (args[0] === "rev-parse") {
        const ref = args.at(-1) ?? "";
        return {
          code: (opts.pushed ?? []).includes(ref.replace("origin/", "")) ? 0 : 1,
          stdout: "",
        };
      }
      if (args[0] === "log" && args.some((a) => a.includes("trailers"))) {
        const { code = "abc1234 ran", security = "abc1234 ran" } = opts.review ?? {};
        return ok(`\x1e${args.some((a) => a.includes("key=Code-Review")) ? code : security}\n`);
      }
      if (args[0] === "log") {
        const range = args.at(-1) ?? "";
        const branch = range.split("..origin/")[1] ?? "";
        const own = opts.subjects?.[branch] ?? [];
        const listed = args.includes("--first-parent")
          ? own
          : [...own, ...(opts.mergedIn?.[branch] ?? [])];
        const shown = args.includes("--no-merges")
          ? listed.filter((s) => !s.startsWith("Merge "))
          : listed;
        return ok(shown.map((s) => `${s}\n`).join(""));
      }
      return { code: 1, stdout: "" };
    },
    env: opts.env ?? {},
    log: (line) => lines.push(line),
    ...(opts.now === undefined ? {} : { now: () => opts.now ?? 0 }),
  };
  return { deps, writes, gitWrites, lines, asked, out: () => lines.join("\n") };
}

export const pr = (number: number, head: string, extra: Partial<FakePr> = {}): FakePr => ({
  number,
  head,
  sha: `sha${number}`,
  base: "main",
  draft: false,
  title: `PR ${number}`,
  state: "open",
  ...extra,
});
