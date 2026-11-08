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
- **Alerts are read by the daemon, later.** The alert fixer takes the alert as text for now. A
  later slice reads code-scanning and Dependabot alerts with a read-only `gh api` call by the daemon,
  so the agent sessions get no network.
- **A post-mortem starts from a failed card in the app (slice 4).** A card with a problem, or whose
  run failed, offers "Draft a post-mortem". The app builds the `incident` text from what it already
  holds (the card, its problem, the failed steps of its run, and the session summary the host
  gives with no model call), as plain English lines. Those words come from an agent session, so the
  text is cleaned and bounded before it is shown: invisible characters go, lines that read as a
  fence or a heading are dropped, a run of dashes is cut short, and the total is cut at 3000
  characters. The person reads and edits it, then Start makes a new card and starts it with the
  `post-mortem` workflow. The failed card is not restarted or changed, so its transcript stays the
  record. No daemon change: the template and the commands existed.
