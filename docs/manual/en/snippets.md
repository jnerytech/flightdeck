# Snippets

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/snippets.md)

**Snippets** are saved commands and prompts. The **Snippets** screen (sidebar, for hosts that keep
them) shows the host's snippets; choose a **Project** to add that project's own and those of its
versioned `.flightdeck/snippets.yaml`, or **Global (this app)** for the ones kept in the app.

- **New snippet**: a name, a type (**Command**, one line, or **Prompt**), the text, tags and where
  to keep it (on the host, in the project, in the project's versioned file, or in the app). Write
  `{{name}}` for a value asked when the snippet is used; the editor shows the fields as you type,
  and each can have a default and a list of options. `{{cwd}}`, `{{branch}}`, `{{file}}` and
  `{{selection}}` come from where the snippet is used.
- A snippet never holds a secret: one is refused with the reason, and **Turn into an action**
  opens the project's Actions with a new action filled in: the command without the secret and an
  environment variable for it, whose vault secret you choose.
- The versioned file is shared with the repository. Until you **Trust the file**, its commands
  only paste, they do not run; changing the file takes the trust away. Entries the app cannot read
  are listed with the reason.
- **Import from the shell history** lists the commands of the host's bash, zsh and PowerShell
  histories, most used first (read only). A line with a token, a key, a password or a value of the
  vault is hidden and cannot be imported; **Reveal hidden lines** shows only the ones the patterns
  found, still locked. The ticked lines go to the host's snippets or to the app's, never to the
  versioned file.
- **Import from a file** reads a YAML or JSON list of snippets (the format of the versioned file), shows what it found and what it left out, and saves the snippets to the host or to the app.
- Favorites (the star) come first, then the most recently used. **Use** on a row opens the snippet to fill and use.

To use one:

- **Ctrl+K**: **Snippet: <name>** (the search also matches tags and content) opens the snippet with
  its fields. A command **pastes into the terminal** on screen (with or without **Enter**), or
  **runs in a new tab** at the folder you give; a prompt is **sent to the session** on screen (managed or a terminal session you can write to), or opens a **New session with this prompt**.
  **Copy** works for both.
- In a terminal tab, **Ctrl+Shift+Space** lists the command snippets of that host and of the app.
- In a session's message box, **/** lists the prompt snippets; the chosen one goes into the box,
  filled from the session's folder, or as written when a field still needs a value.
- Claude can read snippets with the `list_snippets` and `get_snippet` tools of the Flightdeck MCP.
  Flightdeck never runs a snippet for Claude: a command Claude runs goes through Claude Code's own
  permissions.

## From a shell

`flightdeckd snippet` (or `fd snippet`) reads a host's snippets. It works as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share).

```sh
fd snippet render review --value file=src/a.ts --value branch=dev
fd snippet render review --project-path /home/pi/app --json
fd snippet parse snippets.yaml
cat snippets.yaml | fd snippet parse - --json
fd snippet import-history --limit 20
fd snippet import-history --reveal --json
```

- `render <name or id>` prints the text the snippet would produce, with each `--value field=text` filled in. It pastes and
  runs nothing. A field with no value is refused with the daemon's reason and exit `1`. `--project-path` adds that
  project's snippets to the search for the name. Terminal controls and tabs in the text print as spaces; `--json` (`{"id", "name", "text", "fields"}`) keeps the text exact, so use it to pipe a command.
- `parse <file>` sends the text of a YAML or JSON list to the daemon and prints one line per snippet it read (name,
  type and tags); `-` reads the text from stdin. It saves nothing. An entry the daemon left out is said on stderr; a text
  with no snippet at all exits `1`. A text over 1000000 characters is refused before it is sent.
- `import-history` lists the most used commands of the host's shell histories (`--limit` 1 to 200). A line with a
  secret shows what was found, never the value, and cannot be imported; `--reveal` shows only the commands the scan
  hid for a reason it can name. It saves nothing: importing the lines is a later verb.
- `--host <name>` and `--json` work as everywhere. `list` and `get` keep their own raw output.
