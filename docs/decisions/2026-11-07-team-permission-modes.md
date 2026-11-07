# A permission mode per team member (issue #93)

- **Where the mode lives.** `teams.create` takes `coordinatorPermission` and `workerPermissions[]`,
  `teams.update addMember` takes `permission`, and `TeamMember.permission` reports it. A worker's
  mode travels on its card's `variant.permissionMode`, the same place its model already goes, and
  `board.startCard` hands it to `manager.create`. None or null is the host's default.
- **The host decides.** `Teams.checkPermissions` refuses `bypassPermissions` unless the host allows
  it (`bypass_not_allowed`, an existing reason), before the card, the coordinator or any worker is
  started, so a refused team leaves nothing half-made. `manager.create` still checks at start time,
  so a toggle in between, a queued card or a variant saved earlier fail closed. A persona's own mode
  still clamps: it counts when stricter than what was asked.
- **Reviewed.** The `security-reviewer` found nothing high or medium. Low: `auto` is not behind the
  host's bypass switch, in `session.create` either; the form offers only Default, Accept edits, Plan
  and Bypass, so it adds no new way to ask for `auto`.
- **Older daemons.** The host announces `teams.permissions` in `host.info`. Without it the form
  shows no picker, because an older daemon would drop the field and open the member in its default
  mode while the person thinks it is read-only.
- **Bypass asks again.** As in the new-session form, choosing Bypass (for the coordinator or a
  worker, at creation or when adding one) opens a confirmation each time.
- **Layout.** The worker rows are a grid of fixed columns (persona, model, permissions, remove), so
  every row lines up; a host without the picker gets the three-column variant.
