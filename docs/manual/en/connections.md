# Connections

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/connections.md)

**Connections** (sidebar, for hosts that keep SSH destinations) lists the **destinations** saved on
the first online host that announces them, and opens each in a terminal screen running the OpenSSH
client of that host. Flightdeck has no SSH client of its own: it builds the `ssh` command as an
argument list, with no shell in between, and never stores a password or a key, only a reference to
one (a key file path).

- **Connect** first checks the server key. A server never seen shows its **SHA256 fingerprint**
  and waits for **Confirm server key**; only then does the terminal open. Later connections use a
  known-hosts file of Flightdeck's own and require the key to match. A **changed key blocks the
  connection** and shows the kept fingerprint and the new one; nothing connects until you open the
  destination and choose **Forget server key**.
- **New destination**, **Edit**, **Duplicate** and **Remove** (with a confirmation). A destination
  has a name, host, port, user, authentication (the host's **SSH agent**, or a **key file** by its
  path), the host that opens it, an optional **jump** (another destination), tags, and a short
  fixed list of options: keep-alive seconds, compression, local forwards as text and
  **ForwardAgent**, which is off and asks you to confirm before it turns on.
- **Test connection** (in the edit form) runs `ssh` without a terminal and says "Connection ok." or
  the error in words. It does not cover passwords.
- **Import from SSH config** reads the host's `~/.ssh/config` (read only, never written), lists the
  names it found, marks the ones already saved and creates only the ones you tick. Wildcard
  entries (`*`, `?`) are defaults for the others, not destinations.
- **Search** by name, host or user; filter by tag and by the host that opens the destination.
  **Ctrl+K** also offers **Connect to <name>** for each destination.
- The terminal tab of a destination is named "SSH · name" and carries its tags. A destination
  tagged `prod` or `produção` gives that **tab a red border**, so a production server is hard to
  mistake for another.

A destination can also use **Password** authentication: when ssh asks, the app opens a masked
dialog (or one for a key passphrase). The answer goes to the host once, is never stored or logged,
and **Cancel** makes ssh fail at once. With the Vault, **Vault key** authentication picks an SSH key of the vault
(and **Password** may point at a password of the vault, which then answers ssh without a dialog).
The key goes to the host that runs ssh, in the connect command and nowhere else, only if the
secret is allowed for that host and the connection is `localhost` or Tailscale; each use shows in
the vault's **Usage** tab as purpose `ssh`, asked by **You**.

A destination with a **host that opens it** other than the one that keeps it runs ssh there (for
example a VPS, to reach its internal network): Flightdeck keeps a copy of the destination on that
host, and says so on screen if the host is offline or has no SSH support.
