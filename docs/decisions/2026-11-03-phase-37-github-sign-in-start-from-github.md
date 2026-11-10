# Phase 37: GitHub sign-in and start from a GitHub project (phase 37)

- **The sign-in is the host's `gh`, not an OAuth client of ours.** Issue #16 asks for the device flow, the token in the OS
  keyring and the narrowest scopes. `gh auth login --web` is that device flow (a one-time code, no client secret, no OAuth
  app to register) and `gh` keeps the token in the keyring where the host has one. The daemon is Bun and has no keyring
  binding; it never needs one because it never holds the token. `github.status` reads `gh auth status` (account, scopes,
  and whether the login is in the keyring, `gh`'s hosts file or an environment variable) and returns no token. A login that
  comes from `GH_TOKEN` or `GITHUB_TOKEN` is shown as managed by the environment and cannot be signed out from the app.
- **Scopes:** `repo` and `read:project`, fixed in the sign-in arguments. `project` (write) is not asked for in this phase.
- **Names reach `gh` only after they are checked:** a repo is `owner/name`, an issue is digits, a search text is one argument
  after `--`, at most 100 characters and no control character.
- **Start reads the issue before it clones.** A number that does not exist costs nothing. A folder that already is a clone of
  the repo (any form of the `origin` URL) is reused, another repo under that name is refused with `clone_exists`, and a card
  made twice from the same issue is the same card. An issue from outside the repo's people carries phase 13's third-party
  mark in the card and in a session's first prompt.
- **Not verified here:** the exact text `gh` prints for the code and for `gh auth status` was written from memory of the
  current releases and has to be confirmed with a real `gh` and account (the proof of concept in the spec); the fakes
  reproduce it, so a difference shows up as a one-line change in `status.ts` or `login.ts`.
