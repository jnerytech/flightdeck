# Costs follows the data scope (issue #126, slice 3)

Costs used to keep its own host choice in local state: it opened on the first host that reports
costs, and a select offered one host or all of them. It now reads the shared data scope (slice 1),
so Home and Costs show the same hosts.

- **The control.** The toolbar select is the shared `ScopeMenu`, shown with two hosts or more. It
  takes an optional `onPick`, called after a pick, so a screen can end its route override.
- **The default.** Costs opens on All hosts (it opened on the first host), and keeps the person's
  last scope across visits, as Home does.
- **A route's host wins for the visit.** A link that names a host (an alert, a Home card) shows that
  host and never rewrites the scope. `__all__` in a link means every host, as Home sends it. Picking
  in the menu, or Show all hosts, ends the override.
- **A scoped host with no numbers.** One that is offline or does not report costs reads nothing, and
  a notice offers Show all hosts, instead of falling back to another host's numbers. A host still
  connecting gets no notice.
- **CSV across hosts.** The export is offered on All hosts. It asks each host and joins the answers
  into one file whose first column, `host`, is the host's name (`lib/costs-csv.ts`; a name that
  starts like a formula is marked, as the vault report does). A host that does not answer is left
  out of the file; the screen already names failed hosts.
- **Quota across hosts.** Quota is per host by nature, so All hosts shows one line, "Pick a host to
  see its quota", with a button per host that sets the scope. A second menu would repeat the
  toolbar's accessible name.
