/**
 * Issue #1133, slice D2: pushes a plain session's branch (the one `changes.commit` made) and opens
 * its PR, through the same check, push and provider as a card's. The base is never pushed.
 * See docs/decisions/2026-11-08-session-commit.md.
 */
import type { ChangesPrOpened, PrProviderKind, SecretScanner } from "@flightdeck/protocol";
import { git } from "../board/command.ts";
import { type PrProvider, prProvider } from "../board/pr.ts";
import { assertNoSecretInPr, publishPr } from "../board/publish-pr.ts";
import { assertBranchName } from "../board/ref-arg.ts";
import { FlightdeckError } from "../errors.ts";
import type { Changes } from "./changes.ts";
import type { SessionCommits } from "./session-commit.ts";

export interface SessionPrDeps {
  changes: Pick<Changes, "resolve">;
  /** The base each new branch started from, when this daemon made it. */
  commits: Pick<SessionCommits, "baseOf">;
  /** The host's scanner: the title and the description go public. */
  scanner: Pick<SecretScanner, "scan">;
  /** Whether `root` is a card's worktree: a card opens its own PR. */
  isCardWorktree: (root: string) => boolean;
  /** The PR provider of the board project at `root`; null when no project holds it (then GitHub). */
  projectProvider: (root: string) => PrProviderKind | null;
  /** The provider of a kind (`gh`, `az`); the real CLIs when absent. */
  prProvider?: (kind: PrProviderKind) => PrProvider | null;
}

const refuse = (reason: string, message: string) =>
  new FlightdeckError("invalid_state", message, reason);

/** The PRs of plain sessions. */
export class SessionPrs {
  constructor(readonly deps: SessionPrDeps) {}

  /** Pushes the session's current branch and opens its PR with the confirmed title and body. */
  async open(target: string, input: { title: string; body: string }): Promise<ChangesPrOpened> {
    if (!target.startsWith("session:")) {
      throw refuse("changes_pr_target", "only a plain session's branch is opened as a PR here");
    }
    const { root } = await this.deps.changes.resolve(target);
    if (this.deps.isCardWorktree(root)) {
      throw refuse("changes_pr_target", "a card's worktree opens its PR from its card");
    }
    assertNoSecretInPr(this.deps.scanner, input.title, input.body);
    const kind = this.deps.projectProvider(root) ?? "github";
    const provider = (this.deps.prProvider ?? prProvider)(kind);
    if (!provider) {
      throw refuse("project_no_pr_provider", "the project has no PR provider");
    }
    const head = await git(root, "symbolic-ref", "--quiet", "--short", "HEAD");
    if (head.code !== 0) {
      throw refuse(
        "changes_pr_detached",
        "the checkout is on no branch: commit on a new one first",
      );
    }
    const branch = assertBranchName(head.stdout.trim());
    const base = this.deps.commits.baseOf(root, branch) ?? (await remoteDefault(root));
    if (base === null) {
      throw refuse("changes_pr_base", "the branch to open the PR into is not known");
    }
    // Never the base itself: that would push straight into it.
    if (branch === base) {
      throw refuse(
        "changes_pr_on_base",
        `the checkout is on ${base}: commit on a new branch first`,
      );
    }
    const url = await publishPr({
      cwd: root,
      branch,
      base: assertBranchName(base),
      title: input.title,
      body: input.body,
      provider,
    });
    return { url, branch, base };
  }
}

/** The remote's default branch (`origin/HEAD`), without `origin/`; null when it is not known. */
async function remoteDefault(root: string): Promise<string | null> {
  const found = await git(root, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD");
  const name = found.stdout.trim();
  return found.code === 0 && name.startsWith("origin/") ? name.slice("origin/".length) : null;
}
