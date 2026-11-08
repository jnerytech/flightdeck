# BDD: a team's outcome on its card (issue #1220)

## Context

fd-coordinator asked for `.feature` files for what shipped after round 4. The Teams page shows the
coordinator's last report as the team's outcome, on top of the team's card (#1220, #1261).

## Decision

- `team-outcome.feature`, one scenario (en and pt-BR, about 6 s each on the Pi): the demo's active
  team shows the coordinator's outcome marked Done, the outcome sits above the last report of each
  worker, and its box takes the keyboard focus (it scrolls when the report is long).
- The demo seed writes the outcome of the active team (`DEMO_TEAM_OUTCOME`, done) straight into the
  team row, as `teams.report` does. No notification is raised and no other screen's count changes.
- Own state: none to make. The scenario only reads, so the English and the Portuguese run see the
  same team.
- It goes red when the seed leaves the outcome out: the box never shows the report.

## Not covered

The "In progress" badge, a long report that scrolls, a worker's branch and its changes count, and the
notification that opens the team when the coordinator reports done: `team-outcome-ui`, `teams-statuses-ui`
component tests and the daemon's `team-report` test hold them; the demo has no worker with a branch the
steps could read, and a notification needs a coordinator session reporting through MCP.
