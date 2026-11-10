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
