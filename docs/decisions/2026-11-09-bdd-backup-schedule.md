# BDD: scheduled backups (issue #1309)

## Context

Scheduled backups (#1264: engine #1284, Settings panel #1289) are a desktop feature: the panel shows
only when the platform has a `backupFolder`, which the Rust shell gives and the web build does not.
The e2e drives the web build, so it saw no panel.

## Decision

- The demo address takes `backupFolder=demo` (like `update=<version>`): `demoPlatform` then adds a
  stand-in folder that keeps its files in the page's storage, so a page loaded again finds them, as a
  restart finds a real folder. It refuses a name that is not a backup file, as the shell does. A page
  without the switch is the browser's own: no folder, no panel.
- `backup-schedule.feature`, three scenarios (en and pt-BR, 6 to 17 s each on the Pi):
  - a daily schedule with a chosen folder says a backup is due and waits for the passphrase; once it
    is given, the page says the passphrase is set and when the last backup was made, and the folder
    holds one file;
  - after a restart (the page loaded again) the schedule and its folder are kept and the passphrase
    is asked again;
  - with "Files to keep" at 1, a second backup (two days later, the last run moved back in the
    page's storage) leaves one file, and it is the newer one.
- Own state: none shared. Every scenario runs in a page of its own, so the schedule and the folder
  start empty.
- It goes red when the keep value is not set: the folder holds two files.

## Not covered

A failed write (folder gone, no room) and a failed prune: `backup-schedule`, `backup-scheduler` and
`backup-schedule-ui` tests hold them; the stand-in folder never fails. The weekly cadence differs
from the daily one only by its period, which the unit tests hold.
