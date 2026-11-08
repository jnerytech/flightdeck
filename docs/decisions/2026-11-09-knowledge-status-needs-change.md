# A document's status is chosen, then changed with a button (issue #1089)

The knowledge panel wrote the document's file on every `change` of its status select. In Chromium
on Windows (WebView2) the arrow keys on a closed select change its value and fire `change`, so a
keyboard-only person browsing from Valid to Obsolete wrote the file twice (Transitional on the way),
each write racing the stale-hash check of the next.

## Decision

- The select only picks. A **Change** button beside it (named "Change the status of {title}") writes
  the choice, and is off until the choice differs from the file's status. A document that was not
  classified needs a choice first, since its "Not classified" option is disabled.
- A change in flight blocks a second press of Change on that document (a double click or a held
  Enter would write twice with the hash the first one used up) until the list is read again. A
  refused change keeps the choice, so Change can be pressed again once the list has been read again;
  a choice the file now agrees with is dropped when the list comes back.
- After a change that went through, the focus goes to that document's picker, or to the filter in
  use when the filter no longer lists the document.
- Two strings, `projectPage.knowledge.setStatus.apply` and `applyLabel`, in both languages. The
  e2e journey presses the button after choosing.
