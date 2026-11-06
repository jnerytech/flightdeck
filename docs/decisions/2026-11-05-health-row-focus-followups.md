# Health row follow-ups: focus after Add folder, hooks status after Install hooks (issue #206)

- **Add folder** switches to the Settings tab, and the tab's panel stays mounted but hidden until then, so the old code left the focus
  on `body`. `HostPage` now counts the asks and, once Settings shows, focuses the folder box (`data-folder-field`) and scrolls it to
  the middle of the view.
- **Install hooks** from the Health row runs `hooks.install` itself; the `hooks` state of `HostPage` (read once per host and status)
  stayed "absent" until a reconnect. `HostHealth` takes `onHooksChanged`, and `HostPage` asks `hooks.status` again.
