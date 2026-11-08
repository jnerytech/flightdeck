# BDD: a workflow template added from the app (issue #1221)

## Context

fd-coordinator asked for a `.feature` for a workflow template added from the app: a new branch and a
pull request, with a fake `gh`.

## Decision

- `workflow-template-add.feature`: a project of the scenario's own has a local bare repository as
  its `origin` (the base branch pushed there) and GitHub as its PR host, chosen in Edit project.
  From the project's Workflows page the scenario adds the template `alert-fixer`
  (Add from a template, Add to the project, Open the pull request). The page says a pull request was
  opened from a new branch and offers to view it; the remote has the new `flightdeck/workflow-...`
  branch, the base branch holds no workflow file, and the person's checkout is on `main` with a clean
  tree. About 55 to 60 s on the Pi.
- The demo's fake `gh` answers `pr create` with a URL, and no longer rejects the characters a Windows
  `.cmd` shim refuses (`rejectCmdChars: false`): the PR body of a template holds quotes and angle
  brackets, and the demo does not run through a shim.
- It goes red when the add is cut.

## Not covered

Trusting the workflow after the merge (the Workflows page's trust, held by `workflows-ui`), and the
refusals of the add (no origin, no git identity, a branch that is taken): the daemon tests hold them
(`workflow-template-add`, `workflow-templates-server`).
