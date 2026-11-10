# Background sessions

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/background-sessions.md)

Claude Code can run a session with no terminal (`claude --bg`), under its own supervisor, and list
them with `claude agents`. Flightdeck shows those sessions on the host and lets you act on them.
It needs a `claude` that has the command (2.1.139 or later); on a host whose `claude` does not, the
app shows nothing and asks nothing.

- **In Sessions:** a background session is a row of the origin **Background** (the **Origin**
  filter has it). Its state comes from `claude agents --json`: working is running, blocked (a
  question, a permission, an error only you can clear) needs you, done is idle, failed and stopped
  are ended. The hub asks the host again every 10 seconds while it is open. A session the host
  already shows as a Flightdeck or terminal session stays there.
- **Its screen:** a row that has a Claude session opens its screen, with a **Background session**
  panel: its state, what it waits for, its cost (from the usage of its transcripts, since the
  listing has no cost), and
  - **Stop** and **Restart** (`claude stop` and `claude respawn`, which resumes the saved
    conversation and picks up the current Claude Code);
  - **Bring to the terminal** (when the host's terminals are on): opens `claude attach <id>` in a
    terminal tab, where a permission dialog can be answered;
  - **Message**: through the Flightdeck channel when the session was started with
    `flightdeckd claude`, or, for a session with no process, by continuing it with the message as
    its prompt. A background session that is running and has no channel cannot be written to:
    Claude Code has no command for it, and the app says so.
- **Approving:** a permission a background session asks should be answered like a terminal
  session's when the Claude Code hooks of Flightdeck are installed, but this has not been
  confirmed on a real background session yet (see DECISIONS); the sure way is **Bring to the
  terminal** and answering there.
- **Starting one:** tick **Start in the background** in the new-session form (the host must offer
  it), press **Start in the background** on a card that has no session yet (Claude Code puts it in
  its own worktree; the card's text is the prompt), or run `flightdeckd claude --bg "prompt"`. The session runs with the Flightdeck channel and
  the persona, and shows up in Sessions.
- **Good to know:** Claude Code moves a background session that edits files into its own git
  worktree under `.claude/worktrees/`. Shutting down or restarting the machine stops them (they
  show failed, then stopped); sleeping does not. The files `flightdeckd claude --bg` writes for the
  channel and the persona stay, because the session keeps reading them.
