# Project trust follow-ups: the lows left out of #196 (issue #415)

Done, each with a test written first:

- `project.trust.inspect` needs a near connection (loopback or Tailscale), like `project.trust.set`
  to trust: it shows hook commands, MCP server arguments and local-settings values whole. From
  another connection the panel still shows the state and the way to revoke, and says the listing is
  for the computer the host runs on.
- A background session's folder, as `claude agents --json` lists it, is held against the allowed
  roots before `respawn` or `message` runs anything for it (`forbidden_cwd` / `cwd_outside_roots`).
- A session row exists only after its folder's git boundaries were looked at, and a removal that
  took the folder meanwhile refuses the session: a message that arrived in between can no longer
  start a run judged without them.
- Two looks at one folder at once: the one started last is kept, and one that finishes first still
  stores until a newer one has, so no caller goes on with nothing stored.
- `trust()` keeps the scope it is given; an exact trust is compared like the file system compares
  names (`samePath`); a quoted `"hooks":` header key is read; the `.git` file's `gitdir:` line is
  read without a backtracking pattern; the idle account query sets `strictMcpConfig`.
- Sonar smells: `inspect.ts` reads a settings file in small functions (no nested ternaries), and
  `Screens.tsx` trims a project's trailing separators with the existing helper.

Not done:

- **Revoking trust does not stop live sessions.** A session started while the project was trusted
  keeps its hooks and servers until it ends. Ending a person's running session without asking is a
  product decision (and a UI notice that says how many keep running), filed as #463.
- The hostile-project check with a real `claude` stays on the manual list.
- `claudeDo` runs in the daemon's folder, not the session's: Claude Code acts on its own record of
  the session. A symlink retargeted between the check and the run needs write access to a root.
