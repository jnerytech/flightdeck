# Sidebar project tree: fold, cap and remembered fold (issue #215)

- **Cap.** A project lists its first 8 checkouts (`TREE_CAP`; the main one first, then the worktrees by branch name, as the tree already orders them);
  the rest sit behind a button "N more", which becomes "Show fewer". The picked checkout is always listed, even past the cap.
  Expanding is for this run only: a long list should not stay open across starts.
- **Fold.** The project's name is a button with `aria-expanded`; ArrowLeft folds and ArrowRight unfolds it. The fold is remembered per
  project (`hostId/projectId`) on this computer (`flightdeck.treeFolded`), like the sidebar groups. A folded project that holds the
  picked checkout shows a check named "Branch picked: <branch>", so folding never hides that a filter is on.
- **Not built.** Roving focus among the branch lines with the arrows (the lines are plain buttons in the Tab order), and a limit on
  how many projects the tree shows.
