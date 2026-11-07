# One project, one label (issue #881)

Found by #878: Home's leaderboard named a project "docs-site" while Costs' Project filter named the
same project "docs-site · alfa". Each screen told names apart only among the keys it was showing,
and Home shows five rows while its data holds every project.

- **Told apart against everything known.** `projectLabels(keys, known)` joins `known` to `keys`
  before it looks for two names that read the same, and returns only the labels asked for. A name
  on two hosts carries its host (`docs-site · alfa`), or the parent folder when the host does not
  help, wherever the project is shown.
- **What is known.** `AppStore.projectKeys` (`lib/project-keys.ts`), in memory: every key a screen
  has read, plus the keys of the hosts' own project lists (`Project.projectKey`). Home notes the
  keys of its whole week (not only the five rows it lists), and Costs notes the keys of each
  summary it reads. The set only grows during a run, so a label can gain a host once another host's
  project is seen, and then it keeps it.
- **One hook for both screens.** `useProjectLabels(store, keys)` redraws the screen when a new key
  is seen. Home and Costs use it, so they cannot drift apart again.
- **Not covered.** Other screens that show a project by its folder name (the sessions list, the
  board) are not on it yet: they show a project of one host or a name that is not a cost key.
- **The journey.** `ranking-home` compares the label of Home's row with the full text of the
  Costs filter again (it compared only the part before " · " while this was open).
