# What's new reads the releases through the daemon (issue #125)

- **Why the daemon.** The app's Content-Security-Policy lets the webview reach only its own origin and `ws`/`wss`, so it cannot call
  `api.github.com`. The daemon already reads GitHub for its own update manifest; the new command `releases.list` (feature `releases`)
  reads the repository's public releases the same way and hands the app a short, already-parsed list. The app asks the first online
  host that announces the feature.
- **What travels.** Per release: tag, title (the tag when it has none), publication date, the release page's link, and the bullets of
  the `## Highlights` section of its notes as plain text (no bold, code or link markup, 300 characters at most, the rest of the notes
  is never sent). Drafts, pre-releases and any release whose link is not `https` are left out, and a tag or title is cut at 200 characters. A release whose notes have no Highlights section has an empty list: the app
  shows its title and link only.
- **Cost and failure.** One read of the 20 newest releases is kept for an hour and every call slices from it, so opening the screen
  never reaches the GitHub rate limit (60 an hour without a token; the daemon sends none). A failed read (network, a non-200 answer, a
  body that is not a list) is `internal` with the reason `releases_unavailable`, which the app translates; nothing is cached on failure,
  so the next call tries again; calls that arrive while a read is going share it.
- **Not done here.** The app's side (the dialog, the new-dot after an update) is the next change; a token for a higher rate limit and a
  per-host choice of the repository are not needed while the project publishes from one public repository.
