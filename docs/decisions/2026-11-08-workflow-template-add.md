# A workflow template is added from the app as a pull request (issue #1221)

## Context

The workflow templates (#79) were shown and copied: the person pasted the file into an editor,
committed it to the base branch, pushed, and came back to trust it. That is about 11 moves, 5 of
them outside the app (#1215, round 7 of #168). The host already has the repository, commits on a
new branch without touching the checkout (the harness setup, #75), and opens PRs for cards.

## Decision

- **The command.** `workflow.template.add {projectId, templateId, confirm}` returns
  `{path, branch, base, url}`. The host offers it as the `workflowTemplateAdd` feature, with the
  board. Without `confirm: true` it is refused (`workflow_template_confirm`). It is near only
  (`requireVaultTransport`, `transport_refused` otherwise), as the harness commit and `changes.pr`
  are: it pushes from the person's repository, with its pre-push hook running.
- **The content is the host's.** The app names a template by id. The file and its path come from
  the host's own `workflowTemplates()`, with the check line filled the same way the list fills it.
  The command carries no file and no path (the schema is strict). An id the host does not have is
  `workflow_template_unknown`.
- **Never the base branch.** The commit goes on a new branch, `flightdeck/workflow-<id>-<yyyymmdd-hhmm>`
  (UTC), named by the host through `refArg`, from `refs/remotes/origin/<base>`: never the local base,
  whose commits not pushed yet would go up with the PR, and never a tag named like the branch.
  Without that ref the command is refused (`workflow_template_no_head`). The branch is made only if
  no branch has that name (`workflow_template_branch_taken`). A template whose file origin's base or
  the local base (the one the Workflows page reads) already has is refused
  (`workflow_template_exists`): this never replaces a workflow.
- **The person's checkout stays.** The commit is made through a temporary index, as the harness
  setup's is (docs/decisions/2026-11-08-harness-commit.md). That plumbing moved to
  `board/branch-commit.ts`, shared by both, and each caller names its own refusals. Git runs
  disarmed (`SAFE`: no hook, fsmonitor or signature of the repository). The commit uses the
  repository's `user.name` and `user.email` (`workflow_template_identity` without them).
- **The PR as a card's.** `publishPr` pushes the commit by its id to `origin` and opens the PR into
  the base branch through the project's provider (`project_no_pr_provider` without one). The title
  and the body are fixed English lines, git artefacts like the commit message.
- **Trust stays a step of its own.** After the merge, the Workflows page lists the file untrusted,
  as for any workflow. Nothing in this command trusts it.
- **The app.** The template's view gets **Add to the project**, which asks first: what is written,
  where, that the base branch does not change until the merge, and that the workflow does not run
  until it is trusted. Then it links the PR. A host without the feature keeps the copy path and its
  words.

## Left as it is

- **A failed push keeps the local branch.** The branch is made before the push, so a push that
  fails leaves it in the repository. A retry in the same minute is `workflow_template_branch_taken`,
  and the next minute makes a new one. When the push went through and only the provider failed to
  open the PR, the branch is on origin too, with no PR: the provider's refusal says why, and the
  person opens the PR from that branch or deletes it. The daemon does not delete branches.
- **No fetch first.** The branch starts from the last fetched `origin/<base>`, and the file check
  reads that tip and the local base. A stale ref gives a PR on an older base; a file added upstream
  since the last fetch makes the PR conflict, which the PR host shows, and nothing is overwritten.
  A fetch would add a network call with the repository's credential helper to every add.
- **The push runs the repository's own `pre-push` hook and credential helper**, as a card's push
  does (`publishPr`); only the commit plumbing runs disarmed.
- **No secret scan of the file.** It is the host's own template plus the project's test command,
  which the repository already holds. A failed push's output is still scanned before it is shown.

## Alternatives discarded

- **Commit on the base branch.** It skips review, and a workflow's `check` lines run commands.
- **A card that writes the file.** It spends a session on a fixed file, and the agent could change it.
