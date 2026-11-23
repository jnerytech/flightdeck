# Vault

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/vault.md)

The **Vault** (sidebar) keeps secrets: SSH keys, passwords, tokens and sets of environment
variables. A secret's **value** lives in the system credential store (Windows Credential Manager),
never in the app's files and never in a log. The list on the screen holds only the name, the type,
the tags and a description of the secret.

- **New secret** asks for a name, a type, the value and tags. **Generate SSH key** makes an
  `ed25519` pair with the `ssh-keygen` of this computer, keeps the private key in the vault, deletes
  the temporary file and shows the public key, ready to **Copy public key**. **Import key file**
  reads a key file you choose in the system dialog; the original stays where it is unless you tick
  **Delete the original file after importing**.
- **Edit** changes a secret's name, description, tags and allowed hosts, never its value. **Save
  changes** is off, with the reason beside it, while the name is empty. When the form closes, a line
  at the top of the page says the secret was saved. If you uncheck every allowed host the form warns
  that no host will be able to use the secret, and its row then says so; you can still save.
- Each row shows what is safe to show: a key's public key fingerprint, a token's start and end
  (`ghp_…WXYZ`, and nothing for a short one) or the names of an env set. A password shows nothing.
- **Reveal** asks you to type the word `reveal`, then shows the value for 10 seconds. **Copy** puts
  the value on the clipboard and clears the clipboard 30 seconds later. **Remove** asks you to type
  the secret's name and deletes the value from the system store as well.
- **Usage** is a log of every request made of the vault: the secret, the host, the purpose, who
  asked (you, Claude, an automation or a workflow) and the result (delivered, denied or used). It
  never holds a value. Filter it by secret or by who asked.
- **Backup** exports the vault to a `cofre.fdvault` file, encrypted with the passphrase you type
  (at least 12 characters, confirmed twice). **Import vault** reads such a file with its
  passphrase and shows a preview of the **New**, **Same** and **Conflicting** secrets before
  anything changes; a conflict keeps what is in the vault unless you choose **Replace with the
  backup**. A wrong passphrase and a changed file are both refused.

A secret reaches a daemon only when the app sends it, only to a host in the secret's allowed hosts,
and only over `localhost` or Tailscale; the daemon keeps it in memory for at most 60 seconds. In
this version no daemon feature asks for secrets yet, so every request from a daemon is denied.

## Backing up everything

**Settings > Backup** saves one encrypted file with your settings, personas, snippets, hosts (with
their tokens) and the vault. Type a passphrase (at least 12 characters, twice) and press **Back up
now**; the system's save dialog asks where. Only that passphrase opens the file, so keep it.

To **Restore a backup**, type the file's passphrase and press **Read backup**, then pick the file.
Flightdeck shows, for each kind, how many items are new, the same or different here, and lists the
different ones by name. A host is named with where it points, such as `alfa (ws://100.64.0.2:7420)`, so
you see which machine comes back; a login or a query in its address is not shown. Where the app
cannot open a file, the section says that restoring needs the desktop app instead of offering
**Read backup**. Nothing changes until you press **Restore**: a difference keeps what is here
unless you choose **Replace with the backup**, which asks you to confirm. The restore is all or
nothing: if it fails midway, everything is put back as it was. A wrong passphrase and a changed file
are both refused, and change nothing. Close and reopen Flightdeck afterwards to use the restored
settings and hosts. Personas and snippets that a host keeps, or that come from a repository, are not
in the file.

**Scheduled backups** (the desktop app only) sit below, in the same section. Pick **Every day** or
**Every week**, choose a folder with **Choose folder**, and set **Files to keep** (5 by default):
after each backup the oldest files go, and only files named like a Flightdeck backup are ever
touched. The backup is encrypted like the one above, so Flightdeck asks for a passphrase once each
time it starts; it stays in memory until you close the app and is never saved. Until you give it, a
backup that is due waits, and the section says so. A backup that could not be saved is shown there
too, and the date of the last good one stays. The bell says it too, once per start, when a backup
cannot go: the passphrase is missing, no folder is chosen, or a backup failed. A click on the notice
opens **Settings**, section **Backup** (#1327).

When the build carries a Google client, **Where to save** also offers **Google Drive**. It keeps the
backups in Flightdeck's own hidden folder in your Drive, which only this app can see, and each file is
still encrypted with your passphrase. **Sign in with Google** opens Google's page in your browser and
the app waits for the answer on this computer only. Flightdeck keeps the token in the vault, never in
a file or a log; **Sign out** removes it. If Google stops accepting the sign-in, the section and the
bell say so and no backup is made until you sign in again. Without a client in the build, the choice
is not shown (#1444).

To restore from Drive, **Back up everything** > **Restore a backup** offers **Restore from**: **A file**
or **Google Drive** (only with the same Google client, and once you are signed in). **Look in Google
Drive** lists the backups there, newest first. Pick one, type its passphrase and **Read backup**: you
get the same preview as for a file, and nothing changes until you confirm (#1462).

## fd vault

```sh
fd vault decisions [<secret>] [--days <1-365>] [--limit <1-1000>] [--json]
fd vault report [--days <1-365>] [--csv] [--json]
fd vault rules <secret> [--json]
fd vault rules preview <secret> --requester <you|claude|automation|workflow> --purpose <ssh|action|run_with_secret> [--action <name>] [--host <h>] [--project <p>] [--session <s>] [--tag <t>]... [--risk <low|medium|high>] [--approval <always|never|first-per-session>] [--at <time>] [--json]
fd vault watch [--json]
fd vault deny <requestId> [--json]
```

The vault, as the Secrets screen shows it. None of these prints a secret value. Only `deny` changes
anything, and it only refuses: handing a secret over and using it stay in the app.

- **`decisions [<secret>]`:** one line per decision, newest first as the daemon sorts them: time, secret,
  requester, purpose (and the action) on a host, `decision/outcome` with who approved it, and the reason.
  `--days` and `--limit` narrow it; `--json` prints the daemon's answer. The audit cannot be filtered by
  risk or host from here, because the daemon does not filter on them.
- **`report`:** uses counted by secret, requester and outcome. `--csv` prints the text the app saves.
- **`rules <secret>`:** the secret's tags, then one line per rule as the daemon holds it.
- **`rules preview <secret>`:** what a use would get, asked as a dry run: `allow`, `ask` or `deny`, the
  rule or the default that decided, and the reason, with `[once per session]`, `[approval must be held 2 s]`
  or `[limit reached]` when they apply. `--requester` and `--purpose` are needed; `--at` takes an ISO date and
  time with a zone, such as `2026-11-20T03:00:00Z` (now by default). It writes nothing to the audit. A secret named
  `preview` cannot be read with `rules <secret>`.
- **`watch`:** each secret request and each use of a delivered secret, as it comes, until Ctrl-C. A request
  line is `request <id>`, the secret, who asks, the purpose (and the action) on a host, what the rules decided
  (`ask`, or `allow by rule <id>`) and why, with `[once per session]` or `[approval must be held 2 s]`, and
  `runs: <command>` for `run_with_secret`. A use line is `used`, the secret, who, what for and when.
  `--json` writes one frame per line. Alerts are not shown, and no parameter or value ever is.
- **`deny <requestId>`:** refuses a request that waits for you, so the run that waits for it fails at once.
  The id comes from `watch`. It says `denied <id>` (exit `0`), or exit `1` when no request waits under that id
  (answered, expired or never there): it never says "denied" for one it did not refuse. A host from before this
  answer existed is taken at its word.

Exit codes are the same as the other commands: `0` done, `1` refused, `2` no daemon.
