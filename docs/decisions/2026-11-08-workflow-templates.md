# Workflow templates are files to copy and commit (issue #79)

Issue #79 asks for ready-made workflows for recurring agent work. The first slice ships two of the
three proposed (the alert fixer and the post-mortem draft) and a read-only view of them.

- **A template is a file, and the host never writes to the base branch.** Workflows are read from
  the base branch only, and trust is given to one exact content (its hash). A daemon that wrote the
  file would put a workflow in front of the trust screen on its own. So the Workflows screen shows
  the file, copies it, and says where to commit it. Opening a pull request with the file is a later
  option, and it is a write to the repository that needs the security reviewer.
- **The check line takes the project's test command when it is a plain form.** The daemon asks for
  the project's stack (issue #75) and puts `commands.test` in the alert fixer's `check` only when it
  matches `^\w[\w .:/=@-]{0,79}$`, since the line ends up in a shell the person trusts. Anything else,
  and a project whose command is unknown, leaves a placeholder that fails on purpose
  (`... && false`), so a file nobody edited stops at the first run instead of passing.
- **Every template asks before it pushes.** Each has a `gate` right before its `pr` step, a budget
  of turns and minutes, and no `parallel` fan-out of agents. A test fails when a shipped template
  breaks one of these.
- **The tech-debt scan came with the `cards` step (slice 2).** The step takes the findings in an
  earlier agent step's reply, a fenced `json` list of `{ key, title, body }`, and raises them as
  Backlog cards. The agent is not given `create_card`: that tool has no dedupe and no cap, and it is
  the manager's. The reply is untrusted text, and what the agent read in the repository can be
  written by anyone, so the step is strict (only those three fields, a plain key, a one-line title,
  a body of at most 4000 characters, no control or invisible characters, at most 50 items) and one
  bad item refuses the whole list: nothing is created and the run fails with a reason the app
  translates. A run creates at most 10 cards. A finding is skipped when a card of the project has its
  key (a card done in the last 30 days still counts, an older one does not, because debt that
  returns is news), or an open card has the same title. The cards carry the agent mark, the external
  seal and no automatic approval.
- **Alerts are read by the host with its own `gh` (slice 3).** `alert.list` runs two plain GETs
  (`gh api repos/{owner}/{repo}/code-scanning/alerts` and `.../dependabot/alerts`, 30 open each) in
  the project's own folder, so `gh` fills `{owner}` and `{repo}` from that folder's remote and the
  host builds no URL. It holds no token, returns at most 50 alerts (worst first, then newest), and
  names a source it could not read by a short reason (`gh_missing`, `not_signed_in`, `unavailable`,
  `failed`) without `gh`'s own text. The alert's words come from a scanner or an advisory, so the host
  strips control and invisible characters, cuts the lengths, and drops a link that is not https. The
  app copies the text into the `alert` input of the card's workflow, as a multi-line box, and the
  alert-fixer prompt fences it as data. The agent sessions get no network.
