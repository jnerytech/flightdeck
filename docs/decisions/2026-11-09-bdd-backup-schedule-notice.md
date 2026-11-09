# BDD: scheduled backups that cannot go reach the bell (issue #1327)

## Context

With a schedule on, a restart and no passphrase (or no folder, or a failed write) leaves no backup
being made. #1327 (PR #1336) puts one notice in the bell per kind per start, and a press opens
Settings > Backup schedule. It had unit tests and no journey.

## Decision

- `backup-schedule-notice.feature`, three scenarios (en and pt-BR, 13 to 21 s each on the Pi):
  - a daily schedule left on with no passphrase: the restart puts one notice in the bell, and
    pressing it opens the schedule, which asks for the passphrase;
  - with the app open, turning the schedule off and on again does not add a second notice;
  - a schedule left on with no folder says there is no folder, not that the passphrase is missing.
- The demo address `backupFolder=demo` (#1313) gives the page a folder. A schedule "left on by a
  past session" is written into the page's storage, as the app keeps it, and the next load is the
  restart; the bell's stored entries are cleared first so a count is of this start only.
- Own state: every scenario runs in a page of its own, so storage starts empty.
- It goes red when the once-per-start rule is removed: the bell holds 3 notices.

## Not covered

The "A scheduled backup failed" notice (a write that fails): the demo folder never fails, and the
`backup-schedule-notice` unit test holds it. The OS notification beside the bell entry: the web demo
sends none.
