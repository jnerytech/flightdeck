/**
 * Issue #1221: the refusals and the branch name of adding a workflow template to a project. The
 * git and PR calls stay in `../template-add.ts`. See docs/decisions/2026-11-08-workflow-template-add.md.
 */
import { FlightdeckError } from "../../kernel/index.ts";

/** What the shared branch commit (board/branch-commit.ts) reports; this command words each under its own reason. */
type TemplateFailure = "no_head" | "identity" | "branch_taken" | "git";

export const refuse = (reason: string, message: string, params?: Record<string, string>) =>
  new FlightdeckError("invalid_state", message, reason, params);

/** The shared branch commit's failures, under this command's own reasons. */
export function templateRefusal(
  failure: TemplateFailure,
  params: Record<string, string> = {},
): FlightdeckError {
  switch (failure) {
    case "no_head":
      return refuse(
        "workflow_template_no_head",
        "origin has no copy of the base branch to start from: push it, then add the template",
      );
    case "identity":
      return refuse(
        "workflow_template_identity",
        "git has no user.name and user.email for this repository: set them, then add the template",
      );
    case "branch_taken":
      return refuse(
        "workflow_template_branch_taken",
        `the branch ${params.branch ?? ""} is already there`,
        { branch: params.branch ?? "" },
      );
    case "git":
      return new FlightdeckError(
        "internal",
        `git ${params.command ?? ""} failed`,
        "workflow_template_git",
      );
  }
}

/** `flightdeck/workflow-<id>-<yyyymmdd-hhmm>`, in UTC. */
export function branchName(id: string, at: Date): string {
  const stamp = at.toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
  return `flightdeck/workflow-${id}-${stamp}`;
}
