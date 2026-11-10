# Actions: Claude uses a secret without seeing it

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/actions-claude-uses-a-secret-without-seeing-it.md)

An **action** is a command you declare, with places for vault secrets and for parameters. Claude
calls it by name and only chooses the parameters you allowed. The daemon applies the secret on its
side and hands Claude the exit code and the output (up to 32 KB) with the secret masked as
`•••(name)`. Actions need the vault (a secret stored in the app) and a daemon that has them: the
**Actions of <project>** button on a project appears only then.

```yaml
# .flightdeck/actions.yaml (versioned, no secrets) or the project's Actions screen
- name: deploy-staging
  description: Deploys the branch to the staging VPS
  run: ["./scripts/deploy.sh", "{{param.branch}}"]
  cwd: /srv/app
  env:
    DEPLOY_TOKEN: "{{secret.deploy-token-staging}}"
  params:
    branch: { pattern: "^[a-zA-Z0-9._/-]{1,80}$", default: main }
  timeoutS: 600
  approval: first-per-session   # always | never | first-per-session
```

- `run` is a list of arguments and never goes through a shell. A secret goes only to `env` or to a
  temporary file (`{{secretFile.x}}`, deleted afterwards), never to an argument, because arguments
  show in the process list.
- Each parameter must match its whole `pattern`, and a `{{param.*}}` cannot sit where an
  interpreter reads code (after `-c`, `-e`, `/c`, `-Command`, `-EncodedCommand` or `eval`).
- `ssh: <destination>` runs the action on a phase 15 SSH destination of that name, where Claude has
  no shell. The command arrives quoted word by word and the environment goes over stdin; a
  destination that logs in with a key from the vault gets it for that run only. A destination
  with a password cannot run actions.
- `approval` defaults to `first-per-session` for an action with a secret and `never` for one
  without.

## The Actions screen

- Each action shows its description, where it runs (this host, a named host or an SSH
  destination), how it asks for approval, the secrets and parameters it uses, and whether it was
  **Made in the app** or is **Versioned**. Problems in `.flightdeck/actions.yaml` are listed above
  (the valid actions still load).
- **Trust.** An action made in the app is trusted as it is saved. A versioned one shows **Not
  trusted** until you press **Trust <name>** and confirm; the confirmation shows what it runs.
  Trust pins the declaration and the sha256 of `run[0]` and of every file in the argv that is
  inside a git repository, and the daemon checks them again right before each run. If one changed,
  the action shows **Changed since it was trusted** with what changed, and runs again only after
  you trust it again.
- **New action** opens a form: the name, a description, the command one argument per line, an
  optional SSH destination, folder, time limit and approval, the environment variables fed by a
  secret of the vault (the picker shows names and tags, never a value) and the parameters with
  their pattern and initial value. The daemon checks it and what it refuses shows in the form.
  **Edit** and **Remove** (which asks first) are on the actions made in the app; a versioned action
  is changed in its file.
- **Production warning.** An action that runs on this host with a secret tagged `prod` says so on
  its row: a Claude session with Bash on this host could read the secret while it runs. Prefer an
  `ssh:` action for it.
- **Runs.** **Runs of <name>** opens the history, newest first: when, who asked (You, Claude,
  Automation or Workflow), the exit code, the duration and the output, already masked by the
  daemon.

## Approving a request

When Claude, an automation or a workflow runs an action that needs a secret, the request shows in
**Needs you** with a notification: who asked, the action and its parameters (or the command, the
secrets and the host). **Approve** delivers the secret for that run only; **Deny** fails the run
at once. An action with `approval: never` runs without a question, `first-per-session` asks once
and is then remembered until the app restarts, and `always` asks every time. A `run_with_secret`
is high risk: hold the button for 2 seconds to approve it; the tray offers only Deny and Open.

## Usage rules per secret

Each secret has an ordered list of rules: the first that matches a use decides, and without one
the safe default applies (you: allow; Claude with a declared action: ask once per session;
`run_with_secret`: ask every time; automations and workflows: deny; a `prod` tag: ask every time,
holding the button). **Rules of <secret>** on the vault screen edits them: who asks, the purpose,
the action (with `*`), host, tags, project, session, the decision (once per session with **Ask**),
a time window on this computer's clock with what holds outside it, limits per hour and per day,
and an expiry. Move a rule with **Move up**, **Move down** or by dragging.

- **The ceiling:** a rule can loosen a default, but never allow `run_with_secret`, nor allow a
  `prod` secret without a window. The hosts check the rules when you save, and what they refuse
  shows with the reason.
- **What happens if…** under the rules asks a connected host what the saved rules decide for a
  use: the decision, its reason, whether it asks once per session, holds the button or hit a
  limit.
- **Approving:** the request shows the rule that decided and why. Where the rule allows it,
  **Approve and don't ask again this session** approves the rest of that session. **Create a rule from this**
  opens the secret's rules with a new first rule for that requester, purpose and action.
- **Report:** the vault's **Report** tab shows the last 30 days by secret, requester and outcome,
  with **Export CSV**, and each decision with who let it through. A first use by a new requester
  shows an alert, even where a rule allowed it.

## How Claude calls an action

- **MCP (`flightdeckd mcp`):** `list_actions` (name, description and parameters, never secrets),
  `run_action { name, params }` and `run_with_secret { command, secrets, host }`. The last one is
  a command written by Claude itself, with the secrets in its environment: it **always** asks for
  your approval, with the command, the secret names and the host, and it is never automatic, not
  even with automatic approval. It has no "allow always".
- **The `flightdeck` mod** (`mods/flightdeck`, install it with `/plugin install`) registers the
  same tools for terminal sessions without the MCP, shows an "action running" band and the
  `/flightdeck` command. Its tools are `mcp__flightdeck__*`, the same prefix as an MCP server
  added as `flightdeck`, so turn on only one of the two in a session. (Before phase 21 it was
  called `flightdeck-actions`.)
- **The mask** replaces the delivered value, each line of a multi-line value, and its base64,
  URL-encoded and hex forms. A secret transformed another way (a hash, a cut in the middle) is not
  caught, which is why a declared action is the safe path and a free command is not.

## The limit: the same system user

The guarantee is that the secret never reaches the transcript or the model's context through
Flightdeck. It is not isolation from a hostile process of the same user: while an action runs,
its environment (`/proc/<pid>/environ` on Linux) and its temporary file can be read by another
process of the same operating-system user, and a Claude session with Bash on the **same host** can
read them. Keep production secrets in `ssh:` actions.

In a terminal, an action is masked when it runs through `flightdeckd action run` (what the
`flightdeck` mod uses): what it prints is the daemon's masked result. Anything else a
terminal shows is not masked.
