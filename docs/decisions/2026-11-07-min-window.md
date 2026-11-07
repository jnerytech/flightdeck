# The main window can shrink to 360 x 480 (issue #641)

The responsive layout decision sets the floor at 360 x 480 (the Teams floor, a phone-width window
beside an editor). The shell has the drawer, the compact tab button and the narrow top bar now, so
the floor can move down from 720 x 480.

- `apps/desktop/src-tauri/tauri.conf.json`: `minWidth` goes from 720 to 360. `minHeight` stays at
  480, and the window still opens at 1200 x 800.
- The layout guard measures the floor: `GUARD_SIZES` gets 360 x 480, and `OVERFLOW_VIEWPORTS` gets
  360 x 600, so a screen that scrolls sideways or clips at the smallest width fails the e2e run. The
  720 x 480 size stays, since the baseline keys and several journeys name it.
- A test reads `tauri.conf.json` and fails when the floor is not in `GUARD_SIZES`, so the config and
  the guard cannot drift.
- The Rust side sets no size of its own: the floor lives only in the config (checked by
  `tauri-rust-reviewer`).

Not done: the status bar's compact popover and the persisted wide-sidebar fold.
