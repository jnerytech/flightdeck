# Flightdeck — Phase 37 spec (GitHub sign-in and start from a GitHub project)

## Goal

GitHub issue #16: sign in with GitHub and start work from a GitHub project. The person picks a repo or an issue, Flightdeck
clones it into an allowed root on the chosen host (or reuses the clone it finds there), and opens a session or a board
card for it. A card made from an issue carries the issue's title, body and link; a session's first prompt can quote it.

Prerequisites: phase 13 (issues and cards from them), phase 4 (`gh` through the PR providers), and the first-run phase
(`projects.scan` and `projects.clone`, "find my projects").

Decisions (record any divergence in DECISIONS):

- **The host's `gh` is the one signed-in client.** The daemon never holds a GitHub token. Sign-in runs
  `gh auth login --web` on the host, which is the OAuth **device flow** (a one-time code, no client secret in the app, no
  OAuth app of ours to register), and `gh` keeps the token in the OS keyring where one exists. Flightdeck never reads,
  stores, passes around or logs the token; the daemon only reads `gh auth status`. This meets "the token goes to the OS
  keyring, never to a file or a log" without a keyring binding in the daemon. If `gh` already has a login on the host,
  there is nothing to do.
- **Narrowest scopes:** `repo` and `read:project`. `project` (write) is asked for only through a second, explicit sign-in
  when board sync is on; this phase never asks for it.
- **Everything goes through `gh` and `git` on the PATH of the moment**, as the issue providers do, so the tests put fakes there.
- **Clones reuse phase 7's path.** The clone stays inside the allowed roots and every refusal carries a reason.

## Proof of concept first

Needs a real `gh` and a GitHub account, so it is a manual check, recorded in DECISIONS, not a test:

1. `gh auth login --hostname github.com --git-protocol https --scopes repo,read:project --web` with stdin closed or
   a newline: where it prints the one-time code and the URL (stderr or stdout), and whether it waits for the browser
   without a TTY.
2. What `gh auth status` prints for the scopes and the login, on the `gh` versions in use, with and without a
   keyring.
3. `GH_TOKEN` or `GITHUB_TOKEN` in the daemon's environment: `gh auth status` then reports the token's source; the app
   must say the login is managed by the environment and offer no sign-out.

The areas below run on fakes and do not wait for this.

## Design

**Daemon (`apps/daemon/src/github/`), commands announced as the `github` feature when `gh` is allowed:**

| Command | Answer |
| --- | --- |
| `github.status` | `{ installed, loggedIn, login, scopes, source }`; `source` is `keyring`, `file` or `env`. Never a token. |
| `github.login.start` | `{ code, url }`: the device code and the page to open. One login at a time; a second call returns the running one. |
| `github.login.cancel` | stops the running login |
| `github.logout` | `gh auth logout`; refused with a reason when the login comes from the environment |
| `github.repos` | `{ repos: [{ name, description, private, url, updatedAt }] }`: the person's repos, or a search with `query` |
| `github.issues` | `{ issues }` of one repo (`owner/name`): open ones, the person's first, with the author mark of phase 13 |
| `github.start` | clones or reuses, registers the project, then opens a card or a session |

- **`github.login.start`:** spawns `gh auth login` with the fixed arguments above, stdin closed, a time limit, and reads
  the one-time code and the URL from its output. The code is not a secret of ours (it is shown to the person), but it
  stays out of logs. The process ends when the person finishes in the browser; the app polls `github.status`.
- **Names are checked before they reach `gh`:** a repo is `owner/name` (letters, digits, `.`, `_`, `-`), never starting
  with a dash; an issue is digits. Anything else is refused with a reason, as phase 13 does for ids.
- **`github.start { repo, issue?, root, mode }`:**
  1. `root` must be inside the allowed roots (the same refusal as `projects.clone`).
  2. Clone `https://github.com/<repo>.git` into `<root>/<name>`; if `<root>/<name>` already is a clone whose `origin` is
     that repo (any of the https/ssh forms), reuse it. Another folder with that name is refused (`clone_exists`).
  3. Register it as a board project with the GitHub issue integration on, unless it already is one.
  4. `mode: "card"` makes the card the way phase 13 does (title, body, link, a mark and no auto approval for an issue
     from a third party); without an issue it only registers the project. `mode: "session"` starts a session in the
     folder; with an issue its first prompt quotes the issue under the third-party mark when the author is outside.
  5. Answers `{ projectId, path, cardId?, sessionId?, reused }`.
- **Refusals carry a reason:** `gh_missing`, `gh_logged_out`, `gh_scope_missing`, `repo_invalid`, `repo_not_found`,
  `issue_invalid`, `issue_not_found`, `clone_*` (phase 7's), `board_off`.
- **No sync, await everything:** no `*Sync` call, no floating promise.

**App (second slice):**

- Hosts page: a "GitHub" panel on a host that announces `github`: signed in as `<login>`, or **Sign in with GitHub** showing
  the code, a Copy button, and an Open GitHub button (the URL opens in the system browser on this machine, not on the
  host); it waits and flips to signed in.
- A "Start from GitHub" screen reached from the projects screen and the palette: pick a host, search or list repos, pick a
  repo or one of its issues, pick the folder (an allowed root) and "Card" or "Session", then Start; it goes to the card or
  the session. Every refusal shows its translated reason.
- Strings in both dictionaries; both manuals get the steps.

## Tests and criteria

Daemon tests use the fake `gh` and `git` of `scripts/test/fake-cli.ts` (extended with `stderr`), never the network.

| Area | What must pass |
| --- | --- |
| `github-status` | not installed, logged out, logged in with scopes and login, and the three sources; the answer never has a token; a missing `repo` scope is reported |
| `github-login` | the code and the URL are read from `gh`'s output; one login at a time; cancel stops it; a timeout ends it with a reason; the arguments are exactly `auth login --hostname github.com --git-protocol https --scopes repo,read:project --web` |
| `github-logout` | calls `gh auth logout`; refused with a reason when the source is the environment |
| `github-repos` | lists the person's repos and searches by query; the query goes as one argument and never starts a flag; the list is capped |
| `github-issues` | lists a repo's open issues with the third-party mark; a bad repo or id is refused before `gh` runs |
| `github-start` | clones into the root and registers the project; a second start reuses the clone; another folder with the name is refused; a root outside the allowed ones is refused; a card carries title, body, link and the mark; a session's first prompt quotes the issue; nothing is cloned when the issue does not exist |
| `github-protocol` | the commands and results are in the protocol; `host.info` announces `github`; every refusal carries its reason; no token or code in any log (the test greps) |
| `github-app` | the panel, the sign-in states and the start screen in both languages; refusals translated; keyboard reachable; axe clean |
| `github-smoke` | `smoke:github` runs sign-in, list, clone and start against the fake `gh` and a local bare repository and prints `SMOKE GITHUB OK` |

**TDD order:** `github-status`, `github-login`, `github-logout`, `github-repos`, `github-issues`, `github-start`,
`github-protocol` (daemon slice), then `github-app`, `github-smoke`.

**Locks:**

- No token, in any form, is read, stored, returned or logged by Flightdeck.
- No call to the network from a test.
- The scopes in the code are `repo` and `read:project`; a test fails on any other.
- No sync call in the new code (the no-sync ratchet stays at its baseline) and no floating promise.

**Acceptance criteria:** the usual ones, the proof of concept recorded in DECISIONS, both manuals, and the spec-verifier's
verdict is accept.
