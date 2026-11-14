/**
 * Issue #1221: one of the host's workflow templates, committed on a new branch of the project and
 * opened as a PR, as a card's work is. Never the base branch: the file is listed, untrusted, only
 * once the PR is merged, and trust stays a step of its own. See
 * docs/decisions/2026-11-08-workflow-template-add.md.
 */
import type { SecretScanner, WorkflowTemplate, WorkflowTemplateAdded } from "@flightdeck/protocol";
import { commitBase, commitOnNewBranch, safeGit } from "../board/branch-commit.ts";
import { publishPr } from "../board/publish-pr.ts";
import { assertBranchName, FlightdeckError, refArg } from "../kernel/index.ts";
import type { PrProvider } from "../pr/index.ts";
import { branchName, refuse, templateRefusal } from "./domain/template-add.ts";

export interface TemplateAddDeps {
  /** The project's PR host, or null when it has none. */
  provider: Pick<PrProvider, "create"> | null;
  /** The host's scanner: a failed push's output is withheld when it finds a secret in it. */
  scanner?: Pick<SecretScanner, "scan">;
  now?: () => Date;
}

/** Commits the template `templateId` names on a new branch from the base and opens its PR. */
export async function addWorkflowTemplate(
  project: { path: string; baseBranch: string },
  templates: readonly WorkflowTemplate[],
  templateId: string,
  confirm: boolean,
  deps: TemplateAddDeps,
): Promise<WorkflowTemplateAdded> {
  if (!confirm) {
    throw refuse(
      "workflow_template_confirm",
      "adding a workflow template to the project needs confirm: true",
    );
  }
  // The file is the host's own: the app names a template, never a path or a content.
  const template = templates.find((t) => t.id === templateId);
  if (!template) {
    throw new FlightdeckError(
      "not_found",
      `there is no workflow template ${templateId}`,
      "workflow_template_unknown",
      { id: templateId },
    );
  }
  const { provider } = deps;
  if (!provider) {
    throw refuse("project_no_pr_provider", "the project has no PR provider");
  }
  const base = assertBranchName(project.baseBranch);
  // From origin's base, never the local one: a local commit not pushed yet would go up with the
  // PR. The whole ref name, so a tag named like the branch is never read instead.
  const start = await commitBase(
    project.path,
    refArg(`refs/remotes/origin/${base}`),
    templateRefusal,
  );
  // A file the base already has stays as it is: this never replaces a workflow. Both bases: the
  // Workflows page reads the local one, and the PR targets origin's.
  const local = await safeGit(project.path, ["rev-parse", "--verify", "-q", `refs/heads/${base}`]);
  const tips = [start.parent, ...(local.code === 0 ? [local.stdout.trim()] : [])];
  for (const tip of tips) {
    const listing = safeGit(project.path, ["ls-tree", "--name-only", tip, "--", template.path]);
    const listed = await listing; // NOSONAR: two tips at most, the first that has the file refuses
    if (listed.code !== 0) throw templateRefusal("git", { command: "ls-tree" });
    if (listed.stdout.trim() !== "") {
      throw refuse("workflow_template_exists", `${template.path} is already on ${base}`, {
        path: template.path,
        base,
      });
    }
  }
  const branch = refArg(branchName(template.id, deps.now?.() ?? new Date()));
  const title = `Add the ${template.title.en} workflow`;
  const commit = await commitOnNewBranch(project.path, {
    base: start,
    files: [[template.path, template.yaml]],
    message: `${title}\n\nFrom Flightdeck's workflow template ${template.id}.`,
    branch,
    refuse: templateRefusal,
  });
  const body = [
    `Adds \`${template.path}\`, from Flightdeck's ${template.title.en} workflow template.`,
    "It does not run until you trust it on Flightdeck's Workflows page, after the merge.",
  ].join("\n\n");
  const url = await publishPr({
    cwd: project.path,
    branch,
    base,
    title,
    body,
    provider: provider as PrProvider,
    commit,
    ...(deps.scanner ? { scanner: deps.scanner } : {}),
  });
  return { path: template.path, branch, base, url };
}
