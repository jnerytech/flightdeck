# Reviewing changes

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/reviewing-changes.md)

Every session (managed or from the terminal) and every card has a **Changes** tab, next to the
conversation. It is where you check what the agent did and send it back what to fix.

- **What it shows:**
  - for a session whose folder is in a git repository, the working tree against `HEAD`, with the
    untracked files;
  - for a card, the diff against its base, with how many commits it is ahead of and behind it;
  - the files with their status and counts, and the diff unified or side by side, with numbered
    lines. A binary file is listed without a diff;
  - a file that is too large (a diff or a new file over 512 KB) is listed with the **Too large**
    mark and its size, without content, so the panel does not freeze. The same goes for what
    passes 4 MB of diff in total: the files after that are only listed. On a host of this machine,
    **Show in folder** opens the file manager on the file (the editor stays beside it, and refuses
    what is over 1 MB);
  - a file that may hold a credential (`.env*`, `id_*`, `*.pem`, `*.key`, `.npmrc`, what is in
    `.ssh` or `.aws`, and the rest of the list the permission rules use) is listed with the
    **Hidden** mark and no content or counts. The host never reads a new one, and the editor
    refuses to open or save it, even through a link with another name. A link that leads out of
    the repository is refused too;
  - it follows the disk live (the host watches the folder, with a 500 ms debounce), and
    **Refresh** reads it again.
- **Files tab** (when the host lists files): the session's repository as a tree. Folders come
  first, then files, in natural order (`file2` before `file10`); a folder opens on click and is
  read when opened, and again when the session writes or removes a file in it (no need to reopen
  the tab). A changed file carries its status (new, modified, deleted, renamed) from the same diff
  as the Changes tab, live, and every folder above it says **has changes**. A file that may hold a
  credential shows as **Hidden**. `.git` and links that lead out of the repository never show.
  **Filter by name** keeps the names that match among the folders already open, with the folders
  on their way. A folder with more than 500 entries shows the first ones and says so. A session
  outside git has no tree: the tab says so. A click on a file opens it below the tree, read only,
  with numbered lines, and colored by token for common languages (TypeScript, JavaScript, JSON,
  Python, Rust, shell, TOML, YAML, CSS, Go, HTML, XML, diffs, Dockerfiles); a file over 1 MB, one
  that is not text, or a credential says so instead. A
  changed file has **Show changes**: its diff against HEAD, live. While you are at the bottom, the
  newest change scrolls into view as the session edits; scroll up and it stops, and **Jump to
  latest** (with how many changes came) or a scroll back to the bottom brings it back. On a host of
  this computer the viewer also has **Open in its app** and **Show in folder**.
- **Inline comments:**
  - click a line number to comment on it, and shift+click another to extend the range. A removed
    line is commented on its old side. A number shows a Comment mark when you point at it or
    tab to it. The comment box takes the focus: **Ctrl+Enter** adds the comment and **Esc**
    closes the box;
  - comments stay as drafts, which you can edit or remove, until **Send review**;
  - the review goes to the managed session, to the card's session or to the channel of a terminal
    session started with `flightdeckd claude`. A session that takes no messages gets the text
    copied instead, and the comments count as sent;
  - in a session started from Flightdeck, **Review in the message box** puts the same review in the session's message box
    instead, after what you had typed, and opens the conversation: edit it and send it there. The
    drafts stay as drafts (they are only marked sent by **Send review**), so use one or the
    other;
  - a comment follows the quoted lines when the file changes, and shows **Outdated** when they are
    gone. Sent comments stay in the list as history.
- **Second opinion** (on a card, when the host offers it): **Get a second opinion** asks a second
  Claude call to read the card's diff and leave its findings as reviewer drafts. Nothing starts on
  its own: you ask, the button is off while a run goes or when there are no changes, and the host
  refuses (and says why) while it is paused, at the plan quota's pause limit, short of memory or
  at the card's budget, and after 3 reviews of the card in a day. The same diff is reviewed once:
  asking again shows that review. The call has no tools and sees only the card's text and the diff,
  with secrets masked; the diff goes to Anthropic, as the card's own session sends it. Each
  finding that falls on a changed line becomes a draft marked **Reviewer**, with its severity
  (Blocker, High, Medium or Low): edit it (then it is yours), **Dismiss** it, or leave it, and
  **Send review** sends it to the card with your own comments, framed as a suggestion to check.
  The drafts sit after the whole diff: **Go to the drafts**, next to the line that counts them,
  takes you to the first one.
  Findings on no changed line are listed under the button as text. **Open PR** says how many
  reviewer findings are still open when a blocker or a high one is, and opens the PR all the same.
- **Revert and edit:**
  - **Revert** asks for confirmation, goes back to `HEAD` (or the card's base; a new file is
    removed), keeps a copy in `<dataDir>/review-trash/` for 7 days and offers **Undo** for 30
    seconds;
  - **Edit** opens a plain text editor (text files up to 1 MB). It saves only if the file is as it
    was when opened; if it changed on disk, you can reload the disk's text or overwrite it with
    yours;
  - both work only in the folders of `allowedRoots`; anywhere else the host only reads.
- **Sessions that touched a file:** each file lists the sessions that wrote it, from the
  transcripts (`Write`, `Edit`, `MultiEdit` and `NotebookEdit`; changes made by `Bash` do not
  count).
- **Card against its base:**
  - **Update from the base** rebases the card's branch. On a conflict it aborts, leaves the
    worktree as it was and lists the files;
  - **Merge and archive**, for a card without a PR: `merge --no-ff` (the default) or `squash`. If
    the base is checked out in some worktree (usually `main` in the main repository), the merge
    happens there, and only if that worktree is clean; otherwise it goes through a temporary
    worktree. A conflict refuses and changes nothing. After the merge, the card's worktree and
    branch go away and the card moves to Done. The **Commit message** field takes the message
    of the merge; empty keeps the default, with the card's title. **Write with AI** writes it
    from the card's diff, the repository's rules and its recent commits (issue #162).
- **PR comments:** for a card with a PR, the review comments are read from GitHub (`gh api`) or
  Azure DevOps (`az devops invoke`) with each poll of the PR, and listed with file, line, author
  and resolved state. On GitHub, an author who is not the owner, a member or a collaborator gets
  the **External author** badge: treat the text as untrusted. Azure DevOps has no such field, so
  nothing is marked there. The open comments come selected; **Send to the agent** hands the
  chosen ones to the card's session. Nothing is ever posted back to the provider.

The host announces `review` in `host.info`; an older host has no Changes tab.

## The views of a session page

A session page shows one **view** at a time: Conversation, Changes, Files, Time, Trace and
Messages, plus **Terminal** (each only where the host offers it). They are one **tab bar**: the active view is
filled and has a bar under it, and the bar scrolls sideways in a narrow pane.

- **Click** a view, or use the keys: **Alt+1** to **Alt+7** pick the 1st to 7th view of the bar
  (from the message box too; `Ctrl+1` to `Ctrl+9` stay with the app's tabs), and with the focus on
  the bar the **arrow keys**, **Home** and **End** move between views, wrapping around.
- **Terminal** is a shell on the session's host, opened in the session's own folder (its worktree,
  for a card): the host decides the folder, the app only says which session. It opens the first
  time you show the view and lives as long as the session's tab, or until you close it from the
  view (**Close terminal**); switching views only hides it, and a tab that comes back finds the same
  shell. Closing the session's tab ends its shell. It has the terminal's search, copy and paste
  and links. A session started from a terminal ("Claude aqui") shows that terminal instead, and
  closing the tab leaves it running. **Ctrl+\`** switches between the Terminal and the Conversation
  (the shell never receives it). The view needs the host's terminal turned on; an older host has
  none.
- The palette (**Ctrl+K**) lists **Show Changes**, **Show Trace** and the others for the page you
  are on, first among its commands, and the `?` sheet lists the keys under **Session views**.
- The conversation stays where it was: what you typed in its box is still there after a visit to
  another view.
- Each session tab **remembers its last view** while the app runs; a tab you never switched opens
  on the conversation.

## `.worktreeinclude`

A new worktree gets the repository's tracked files, but not the ignored ones, such as `.env`. To
take them to the card, create `.worktreeinclude` at the root of the repository, with patterns in
the `.gitignore` format:

```gitignore
.env
.env.local
config/*.secret.json
```

- **What is copied:** from the main repository, the files **ignored by git** that match the
  patterns, up to 50 MB in total. Above that, the card says how many were left out.
- **What is never copied:** anything under `.git/` or `.flightdeck/`.
- **Built-in pattern:** `.claude/settings.local.json`, the project rules from phase 7, is always
  included.
- The project form in the app warns when the repository has no `.worktreeinclude`, with an example.

## Claude Code statusline

`flightdeckd statusline` prints a line like `5h 35% · 7d 27% · today $4.20 · session $0.84`: the
plan quota, the estimated cost of the day and the cost of the session. It reads the JSON that
Claude Code passes on stdin and asks the local daemon, with a deadline of 300 ms. With the daemon
down or slow, it prints an empty line and exits with 0.

Flightdeck **never writes** the statusline configuration. To use the command, put it yourself in
`~/.claude/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "flightdeckd statusline" } }
```

To add it to a statusline you already have, call both in a script and join the lines. The stdin
goes to both:

```bash
#!/usr/bin/env bash
input=$(cat)
mine=$(printf '%s' "$input" | ~/.claude/my-statusline.sh)
fd=$(printf '%s' "$input" | flightdeckd statusline)
printf '%s%s\n' "$mine" "${fd:+ · $fd}"
```

The command uses the daemon's config (`~/.flightdeck/config.json`, or `--config <file>`) and never
creates it.
