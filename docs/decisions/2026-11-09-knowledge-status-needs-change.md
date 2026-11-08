# A document's status is chosen, then changed with a button (issue #1089)

The knowledge panel wrote the document's file on every `change` of its status select. In Chromium
on Windows (WebView2) the arrow keys on a closed select change its value and fire `change`, so a
keyboard-only person browsing from Valid to Obsolete wrote the file twice (Transitional on the way),
each write racing the stale-hash check of the next.

## Decision

- The select only picks. A **Change** button beside it (named "Change the status of {title}") writes
  the choice, and is off until the choice differs from the file's status. A document that was not
  classified needs a choice first, since its "Not classified" option is disabled.
- A change that went through clears the pending choice; a refused one keeps it, so the person can
  press Change again once the list has been read again.
- Two strings, `projectPage.knowledge.setStatus.apply` and `applyLabel`, in both languages. The
  e2e journey presses the button after choosing.
