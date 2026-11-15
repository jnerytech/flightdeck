import { FlightdeckError } from "../../kernel/index.ts";
import { SETTINGS } from "./settings-proposal.ts";
import { plainName } from "./template-vetting.ts";

/** What the shared branch commit (publish/branch-commit.ts) reports; the harness words each under its own reason. */
type BranchCommitFailure = "no_head" | "identity" | "branch_taken" | "git";

/**
 * The files a setup writes: the settings, CLAUDE.md, and an agent or a skill under a plain name (a
 * template's, #75 T1b). Nothing else can be committed this way: never a `.env`, a hidden name or `..`.
 */
export function setupFile(name: string): boolean {
  if (name === SETTINGS || name === "CLAUDE.md") return true;
  const agent = /^\.claude\/agents\/([^/]+)\.md$/.exec(name)?.[1];
  const skill = /^\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(name)?.[1];
  const plain = agent ?? skill;
  return plain !== undefined && plainName(plain);
}

export const refuse = (reason: string, message: string, params?: Record<string, string>) =>
  new FlightdeckError("invalid_state", message, reason, params);

export const stale = () =>
  refuse("harness_commit_stale", "the files are not as the setup wrote them: apply again");

/** The shared branch commit's failures, under the harness's own reasons and words. */
export function harnessRefusal(
  failure: BranchCommitFailure,
  params: Record<string, string> = {},
): FlightdeckError {
  switch (failure) {
    case "no_head":
      return refuse("harness_commit_no_head", "the project has no commit to start a branch from");
    case "identity":
      return refuse(
        "harness_commit_identity",
        "git has no user.name and user.email for this repository: set them, then commit",
      );
    case "branch_taken":
      return refuse(
        "harness_commit_branch_taken",
        `the branch ${params.branch ?? ""} is already there`,
        { branch: params.branch ?? "" },
      );
    case "git":
      return new FlightdeckError(
        "internal",
        `git ${params.command ?? ""} failed`,
        "harness_commit_git",
      );
  }
}
