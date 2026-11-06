# New session, journey J3 (issue #186)

- **Done.** With two or more hosts online the new-session form has a Host field (changing it opens that host's form); the "New session" buttons of the empty window and the start screen use the host last used, not the first one; the Sessions list header has a New session button; the "no allowed folder" reason has a link to the host's page. The e2e journey `nova-sessao-host` was not run on the Pi (CI runs it).
- **Not done.** Create sitting below the fold at 1280x800: it needs a layout pass on the form, not a one-line fix.
