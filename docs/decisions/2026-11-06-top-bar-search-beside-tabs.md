# The top bar keeps the tabs, so its search sits on the right (issue #282)

- **Why.** The user's reference (LiteLLM's Home) puts the search in the middle of the top bar. Ours shares
  that row with the tab strip, which moved into the header to save height at 720x480 (#232 keeps a
  150 px conversation there). A second row would spend that margin again.
- **Chosen.** One row: the sidebar toggle, the host switcher, back/forward and the breadcrumb in the
  crumbs' fixed 24 rem box (so the tabs start at the same x), the tab strip, then the search, the theme
  button, the bell and the version on the right. Below 960 px the search is its icon (same name and
  Ctrl K), and the version hides.
- **Names.** The search is "Search or jump to… (Ctrl+K)" and the theme button says what it switches to,
  so neither repeats the sidebar foot's "Search the history" and "Toggle theme" while both exist. The
  foot loses them in part 2, with the account row (#213).
- **The switcher** selects a host (`store.select`), the state the new-session form and the simple mode
  already follow; it adds no new notion of a current host.
