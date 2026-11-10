# Setup checklist

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/setup-checklist.md)

A **Setup** row at the top of the sidebar's Work group shows a ring and a count (for example
`1/4`) while the steps to get going are not all done. It opens the **Setup** screen: a list of
steps, each with one sentence and one button that opens the screen where it is fixed. A step is
done when the app can see that it is: it is read from your hosts and the app, never ticked by hand,
so connecting a host moves the ring at once and removing it moves it back.

- **To get going:** connect a host (one online); install the Claude Code hooks on it (the host page
  says installed); add a project with a base branch; start a first session or card. The step the
  screen marks as current (the first one not done) has the filled button.
- **Worth doing:** sign in to GitHub on the host, check that notifications work (a test
  notification reached the system once), set a budget, and add a `.worktreeinclude` to a project.
  The row does not wait for these.
- A step the host cannot do (it does not announce the feature) is left out, not left undone.
- The row leaves by itself once the four steps to get going are done. **Hide** (the eye button that
  shows beside the row, or on the Setup screen) removes it for good; Settings, Window, **Show the
  setup checklist** brings it back. Simple mode shows none of this.
- A tool a host lacks (the GitHub CLI, `claude`) gets a quiet card on the Start screen, not a red
  banner, with a link to how to install it and **Dismiss**.
