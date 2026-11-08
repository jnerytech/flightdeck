# BDD: Settings > Backup, and a file dialog for the web build (issue #1241)

## Context

fd-coordinator asked for `.feature` files for Settings > Backup: back up, restore with the preview,
a wrong passphrase changes nothing. The e2e journeys run the web build in Chromium, and that build's
`platform.vault.pickFile` was a stub that always answered `null`, so Restore could not read a file.

## Decision

- The web build's `pickFile` now goes through a file input (`platform/pick-file.ts`): the chosen file
  is read as text, a cancel answers `null`, a file over 1 MiB is refused before it is read (the
  desktop shell holds the same cap). A window that cannot make an input still answers `null`.
  Security review: no high or medium finding (`Security-Reviewed:` trailer on the commit that
  closes the slice).
- `backup.feature`, three scenarios, each in a browser context of its own (the app's settings live in
  that context's storage, so nothing is shared):
  - back up everything into one encrypted file: the page's save dialog is replaced by one that keeps
    what is written; the file is armored (`-----BEGIN AGE ENCRYPTED FILE-----`) and does not hold the
    passphrase;
  - passphrases that differ save nothing;
  - a wrong passphrase reads nothing and offers no Restore; the right one only previews (the backup
    names its kinds, and says nothing here is new) and restores nothing. The file dialog of the read is
    answered by the test with the file the scenario saved.
- Each goes red when its key step is cut (no back up; the wrong passphrase replaced by the right one;
  the read with the right passphrase removed).

## Not covered

Applying a restore (a difference replaced, the confirm, the "Restored" line) and the vault's
secrets: the component tests hold them (`backup-all-ui`, with a fake vault and a temp profile).
A scenario would have to change the app's settings between the backup and the read, and the web
build keeps its tokens and vault values in memory only, so a restore there proves less than on the
desktop.

## Seen, not changed

The review noted that the vault import's "Delete the original file after importing" box shows on the
web build, where `removeFile` does nothing, so a person could believe the key file was deleted.
