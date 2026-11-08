# The backup bundle: one encrypted file with the app's own data (issue #1241)

First slice of the Google backup (#58, #13): the bundle, its encryption and the restore, with a
file as the destination. Google Drive becomes a second destination later and reuses the same text.

## What is in the file

One JSON document, encrypted whole, `kind: "flightdeck-backup"`, `version: 1`, `createdAt`:

- **settings:** the preference keys in `BACKUP_SETTING_KEYS` (`apps/desktop/src/lib/backup-bundle.ts`).
  A key outside the list (window state, logs, caches, anything with a path of this machine) is never
  written by a restore, whatever the file says.
- **personas and snippets:** the app's own (`flightdeck.personas`, `flightdeck.snippets`), as lists
  of items with an id, merged by id.
- **hosts:** the host list (id, name, URL) **with each host's token**, encrypted, so a restored
  profile reaches its hosts without pairing again.
- **vault:** every secret with its metadata and its value, as the `.fdvault` export does.

Not in the file: personas and snippets that a host keeps, and the ones that come from a
repository's files (they go through that repository's trust flow). Per-host data is a later slice.

## Encryption

The vault's own: `age` with a passphrase (scrypt, work factor 18), at least 12 characters, typed
twice. The file is the armored text, built in memory and handed to the save dialog: no temp file.
A wrong passphrase, a tampered file and a file that is no backup fail the same way
(`BackupError("unreadable")`) and change nothing.

## Restore

1. `previewRestore` decrypts and checks the whole bundle (a strict schema) and compares it with
   this profile. The preview holds names and counts per kind (added, same, conflicting) and never a
   value; the decrypted bundle is kept apart in memory, so a preview can be shown or logged.
2. `applyRestore` runs after the person confirms, with a choice for conflicts (Skip or Overwrite).
   It is all or nothing: every change is a step that remembers what it found. The keyring and the
   host tokens go first (they can fail and can be undone), the plain settings last. A failure
   undoes the steps that ran, the failing one included, in reverse order.
3. The app's storage cannot delete a key, so a key that did not exist and has to be undone is
   left empty. Every reader of these keys treats an empty value as absent.

## Left out on purpose

- A host that is offline or a partial restore across hosts: there is no host data in this slice.
- A schedule, versions and Google Drive: the next slices of #58.
