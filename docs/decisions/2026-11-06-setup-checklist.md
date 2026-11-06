# The setup checklist (issue #164)

Ported from the stranded `setup-checklist` branch onto current `main`; its entry of `DECISIONS.md`, moved to a file of its own (#304).

- **Derived, never ticked.** `lib/setup-steps.ts` reads the app's state and what hosts answer: hosts online, `hooks.status`
  (`installed`), projects with a base branch, any session or started card, `github.status`, budgets, a project's `.worktreeinclude`.
  The hooks and GitHub answers are asked once when a host connects (and again after the hooks are installed or removed and after a
  GitHub sign-in or sign-out) and kept in `setupProbes`; a host that cannot answer leaves the step undone, not blocked.
- **A step a host does not announce is left out** (`central` for hooks, `workflows` for projects, `github`, `costs`). With no host
  online nothing is announced yet, so the steps stay: a fresh app reads 0/4, as the issue asks.
- **Four core steps count.** The ring is the core steps done of the core steps that apply; when they are all done the row goes away.
  The optional steps are on the Setup screen and never hold the row back.
- **"Check that notifications work"** is done when a test notification reached the system once (`SetupSettings.markNotified()`,
  kept on this computer). The test notification belongs to #149 (notification preferences), so until that branch is merged this step
  has nothing that completes it; whoever merges #149 adds `markNotified()` to its `sendTestNotification`.
- **The `run.yaml` half of the issue's last step is not a check.** The project record says whether it has a `.worktreeinclude`, not
  whether it has a `run.yaml`, so only the first is read.
- **Hide is a button, not a context menu.** The issue says right-click; a button beside the row (shown on hover and focus) is
  reachable by keyboard and by touch, and the Setup screen has one too. Restore is in Settings, Window.
- **Missing tools** are a quiet card on the Start screen (muted, an info icon, a link to the install page, Dismiss kept per tool and
  host). The host page already shows the full health list, so it gets no second card.
