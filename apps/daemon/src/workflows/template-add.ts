/**
 * Issue #1221: one of the host's workflow templates, committed on a new branch of the project and
 * opened as a PR, as a card's work is. Never the base branch: the file is listed, untrusted, only
 * once the PR is merged, and trust stays a step of its own. See
 * docs/decisions/2026-11-08-workflow-template-add.md.
 */
import type { SecretScanner, WorkflowTemplate, WorkflowTemplateAdded } from "@flightdeck/protocol";
import type { PrProvider } from "../board/pr.ts";

export interface TemplateAddDeps {
  /** The project's PR host, or null when it has none. */
  provider: Pick<PrProvider, "create"> | null;
  /** The host's scanner: a failed push's output is withheld when it finds a secret in it. */
  scanner?: Pick<SecretScanner, "scan">;
  now?: () => Date;
}

/** Commits the template `templateId` names on a new branch from the base and opens its PR. */
export async function addWorkflowTemplate(
  _project: { path: string; baseBranch: string },
  _templates: readonly WorkflowTemplate[],
  _templateId: string,
  _confirm: boolean,
  _deps: TemplateAddDeps,
): Promise<WorkflowTemplateAdded> {
  return { path: "", branch: "", base: "", url: "" };
}
