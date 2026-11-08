# A team's outcome comes from its coordinator's explicit report (issue #1220)

## Context

#1220 wants a team's outcome at the top of its card, and a notification when the coordinator reports
the goal done. It assumed `teams.status()` `lastReport` already holds that. It does not:

- `lastReport` is a member's last message to another session. The coordinator talks to the person in
  its own chat, so its `lastReport` is usually the last task it sent to a worker.
- Nothing says "done". `teams.updated` carries a `reason` only for a quota pause or resume, as text
  the app shows untranslated.

## Decision

- **An explicit report.** A new MCP tool, `team_report { team, text, done }`, goes through a new
  command, `teams.report { team, text, done, as }`. The daemon keeps the last report per team: the
  `teams.report_text`, `report_at` and `report_done` columns, through a migration.
  `TeamStatus.outcome` (`{ text, at, done }` or null; optional) returns it.
- **Only the coordinator, checked by the host.** The host resolves the asking session from `as`
  (`messaging.whoIs`), as `team_status` does, and refuses any session that is not the team's
  coordinator (`team_report_not_coordinator`). A closed team refuses as before (`team_closed`). The
  prompt does not grant the right; the host does.
- **Length capped.** The text is at most 4000 characters (`TEAM_REPORT_MAX`), in both the MCP schema
  and the protocol schema.
- **Untrusted text.** The report is what a session wrote. The app shows it as plain text, never as
  markup. The instructions say no secrets go in it.
- **"Done" as an event, not a reason.** A `done: true` report sends `teams.updated` with
  `event: "report_done"` and `reason: null`. The approval said `reason: "report_done"`, but today's
  app shows `reason` as the notification body, untranslated. An older app would have shown the
  bare word. With an `event` field, the app notifies in the person's language (slice A), and an
  older app ignores it.
- **The instructions (version 2)** gain a step: when the goal is met and integrated, call
  `team_report` with `done: true`; a progress report goes with `done: false`. The step is in
  Portuguese like the rest of that prompt.

## Discarded alternatives

- **Inferring "done"** from the coordinator going idle after the last worker message, with the
  workers idle. A coordinator waiting for the person looks the same, and a notification would
  mislead.
- **"Done" only when the person closes the team.** It never tells the person that the team finished.

## Consequences

- One more MCP tool for every session (21). A worker that calls it is refused by the host.
- The app (slice A) shows the outcome on the team card, with each worker's last report, branch,
  changes count and session link, and notifies on `report_done`.
