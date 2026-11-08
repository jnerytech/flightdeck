import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CreatePr, PrProvider } from "../src/board/pr.ts";
import { addWorkflowTemplate } from "../src/workflows/template-add.ts";
import { workflowTemplates } from "../src/workflows/templates.ts";
import { git, gitRepoWithOrigin } from "./board-helpers.ts";

/**
 * Issue #1221: a workflow template is committed on a new branch the host names, pushed, and opened
 * as a PR into the base branch. The base branch and the person's checkout stay as they are.
 */

// Real git in temporary repositories, with a local bare origin: more than the default 5 s.
setDefaultTimeout(20_000);

const AT = () => new Date("2026-11-08T14:05:00Z");
const TEMPLATES = workflowTemplates("bun run test");
const FILE = ".flightdeck/workflows/alert-fixer.yaml";
const BRANCH = "flightdeck/workflow-alert-fixer-20261108-1405";
const URL = "https://github.com/o/r/pull/7";

/** A PR host that records what it is asked to open. */
function host() {
  const created: CreatePr[] = [];
  const provider: Pick<PrProvider, "create"> = {
    create: async (opts) => {
      created.push(opts);
      return URL;
    },
  };
  return { provider, created };
}

/** A git call whose failure (a ref that is not there) is a value, not an error. */
function maybe(cwd: string, ...args: string[]): string | null {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
}

/** The refusal reason a call ends with, or "resolved" when it does not throw. */
async function reasonOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "resolved";
  } catch (error) {
    return (error as { reason?: string }).reason ?? String(error);
  }
}

/** A repository with a local bare origin and the person's identity: they will push the branch. */
function project(identity = true) {
  const made = gitRepoWithOrigin();
  if (identity) {
    git(made.repo, "config", "user.name", "Ana");
    git(made.repo, "config", "user.email", "ana@example.com");
  }
  return made;
}

const branches = (repo: string) => git(repo, "for-each-ref", "--format=%(refname)", "refs/heads/");

describe("adding a workflow template from the app (#1221)", () => {
  test("the template is committed on a new branch from the base, pushed and opened as a PR; the base and the checkout stay", async () => {
    const { repo, remote } = project();
    const main = git(repo, "rev-parse", "main");
    // The person works on another branch, with a staged file and an unsaved change.
    git(repo, "checkout", "-q", "-b", "work");
    writeFileSync(join(repo, "README.md"), "# changed\n");
    writeFileSync(join(repo, "new.txt"), "new\n");
    git(repo, "add", "--", "new.txt");
    const status = git(repo, "status", "--porcelain");
    const { provider, created } = host();

    const added = await addWorkflowTemplate(
      { path: repo, baseBranch: "main" },
      TEMPLATES,
      "alert-fixer",
      true,
      { provider, now: AT },
    );

    expect(added).toEqual({ path: FILE, branch: BRANCH, base: "main", url: URL });
    const template = TEMPLATES.find((t) => t.id === "alert-fixer");
    expect(maybe(repo, "show", `${BRANCH}:${FILE}`)).toBe(template?.yaml.trim() ?? "");
    expect(maybe(repo, "rev-parse", `${BRANCH}^`)).toBe(main);
    expect(maybe(repo, "diff", "--name-only", "main", BRANCH)).toBe(FILE);
    expect(maybe(remote, "rev-parse", BRANCH)).toBe(maybe(repo, "rev-parse", BRANCH));
    expect([git(repo, "rev-parse", "main"), git(repo, "branch", "--show-current")]).toEqual([
      main,
      "work",
    ]);
    expect(git(repo, "status", "--porcelain")).toBe(status);
    expect(created.map(({ cwd, base, head }) => ({ cwd, base, head }))).toEqual([
      { cwd: repo, base: "main", head: BRANCH },
    ]);
    expect(created[0]?.title ?? "").toBe("Add the Alert fixer workflow");
    expect(created[0]?.body ?? "").toContain(FILE);
  });

  test("it is refused, with nothing made or opened, without confirm, for a template the host lacks, with no PR host, when either base has the file, with no origin copy of the base, or with no git identity", async () => {
    interface Case {
      name: string;
      confirm?: boolean;
      id?: string;
      withHost?: boolean;
      identity?: boolean;
      /** Changes the repository before the call. */
      arrange?: (repo: string) => void;
    }
    /** The template's file, committed on the current branch. */
    const commitFile = (repo: string) => {
      mkdirSync(join(repo, ".flightdeck", "workflows"), { recursive: true });
      writeFileSync(join(repo, FILE), "steps: []\n");
      git(repo, "add", "--", FILE);
      git(repo, "commit", "-q", "-m", "workflow");
    };
    const cases: Case[] = [
      { name: "no confirm", confirm: false },
      { name: "unknown template", id: "not-a-template" },
      { name: "no PR host", withHost: false },
      { name: "on the local base", arrange: commitFile },
      {
        name: "on origin's base only",
        arrange: (repo) => {
          git(repo, "checkout", "-q", "-b", "elsewhere");
          commitFile(repo);
          git(repo, "push", "-q", "origin", "elsewhere:main");
          git(repo, "checkout", "-q", "main");
          git(repo, "branch", "-q", "-D", "elsewhere");
          git(repo, "fetch", "-q", "origin");
        },
      },
      {
        name: "no origin copy of the base",
        arrange: (repo) => git(repo, "update-ref", "-d", "refs/remotes/origin/main"),
      },
      { name: "no identity", identity: false },
    ];
    const seen: string[] = [];
    for (const c of cases) {
      const { repo } = project(c.identity ?? true);
      c.arrange?.(repo);
      const before = branches(repo);
      const { provider, created } = host();
      const reason = await reasonOf(() =>
        addWorkflowTemplate(
          { path: repo, baseBranch: "main" },
          TEMPLATES,
          c.id ?? "alert-fixer",
          c.confirm ?? true,
          { provider: (c.withHost ?? true) ? provider : null, now: AT },
        ),
      );
      const same = branches(repo) === before ? "same" : "changed";
      seen.push(`${c.name}: ${reason}, branches ${same}, PRs ${created.length}`);
    }
    expect(seen).toEqual([
      "no confirm: workflow_template_confirm, branches same, PRs 0",
      "unknown template: workflow_template_unknown, branches same, PRs 0",
      "no PR host: project_no_pr_provider, branches same, PRs 0",
      "on the local base: workflow_template_exists, branches same, PRs 0",
      "on origin's base only: workflow_template_exists, branches same, PRs 0",
      "no origin copy of the base: workflow_template_no_head, branches same, PRs 0",
      "no identity: workflow_template_identity, branches same, PRs 0",
    ]);
  });

  test("the branch starts from origin's base: a local commit not pushed yet never goes up with it", async () => {
    const { repo, remote } = project();
    const pushed = git(repo, "rev-parse", "main");
    writeFileSync(join(repo, "private.txt"), "not pushed\n");
    git(repo, "add", "--", "private.txt");
    git(repo, "commit", "-q", "-m", "local only");
    const { provider } = host();
    await addWorkflowTemplate({ path: repo, baseBranch: "main" }, TEMPLATES, "alert-fixer", true, {
      provider,
      now: AT,
    });
    expect(maybe(repo, "rev-parse", `${BRANCH}^`)).toBe(pushed);
    expect(maybe(remote, "cat-file", "-t", git(repo, "rev-parse", "main"))).toBeNull();
  });

  test("a second add in the same minute finds its branch taken and opens no second PR", async () => {
    const { repo } = project();
    const { provider, created } = host();
    const add = () =>
      addWorkflowTemplate({ path: repo, baseBranch: "main" }, TEMPLATES, "alert-fixer", true, {
        provider,
        now: AT,
      });
    expect([await reasonOf(add), await reasonOf(add)]).toEqual([
      "resolved",
      "workflow_template_branch_taken",
    ]);
    expect(created).toHaveLength(1);
  });
});
