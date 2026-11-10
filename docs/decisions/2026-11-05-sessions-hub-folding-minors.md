# Sessions hub folding minors (issue #241)

- **The cap keeps folded headers.** `capGroups` used to stop at the first group after the cap was spent, so projects folded to nothing
  after it lost their headers. A project with no rows to draw costs no row: its header stays; one with rows that comes after the cap is
  left out and counted in "show more", as before.
- **A Hosts chip does not unfold.** It chooses whose sessions the list is about, not what to look for, so `isSearching` leaves it out
  (text, origin, state, persona and pinned still open what they keep, and still show the earlier sessions).
- **The fold key is the project's merged identity** (`foldKey`: the daemon's key for a resolved project, `folder:<name>` for a folder seen
  on several hosts, the host's folder key when two folders of one host share a name), not the smallest project key among the rows
  present, which changed when a host went offline. `group.key` still names a real project for the client scope. A fold saved under the
  old key still counts until the person chooses again; no migration of storage.
