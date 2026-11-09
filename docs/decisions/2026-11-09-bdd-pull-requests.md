# BDD: the Pull requests page (issue #1345)

## Context

The Pull requests page lists every open PR of the online hosts, with its checks and what can be done
to it: Merge PR (after a confirmation) when the host merges and the checks do not fail. The
`pull-requests` journey holds the two-host listing and one merge.

## Decision

- `pull-requests.feature`, four scenarios (en and pt-BR), on what the demo already holds: alfa's PR
  (checks passing, the fake `gh` refuses its merge) and beta's PR with failing checks (the card the
  "While you were away" seed adds, #1369). The scenarios merge nothing that stays merged, so they do
  not move the journey's own merge.
  - the open PRs of both hosts are on one page, each with its host, and beta's shows failing checks;
  - Merge PR is offered on the PR whose checks pass and not on the one whose checks fail;
  - Merge PR asks first: the dialog shows the PR's address, and Cancel leaves the PR and its button;
  - a merge the host refuses (it waits for a review) is told on the page and the PR stays.
- It goes red when a failing-checks PR is allowed to merge: the scenario finds the button on beta's row.

## Not covered

The watch line and the update from the base (`pull-requests-ui` holds them), the empty page and the
page with no host online, and the conflict, review state and age that wait on #1352.
