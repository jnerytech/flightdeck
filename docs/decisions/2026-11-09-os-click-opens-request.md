# A click on a request notification opens that request on the desktop app (issue #1131)

## What changed

`docs/DECISIONS.md` (phase 8) records that the desktop notification plugin reports no clicks, so the
request link in a notification had nowhere to go on the desktop app and the tray was the quick action.
That is no longer true: `tauri-plugin-notification` 2.8 reports a click on desktop (Windows, macOS and
Linux) as an `actionPerformed` event, but only for a notification shown while a JavaScript `onAction`
listener existed, and it hands back the `extra` the notification carried.

## Decision

- `notify` of the Tauri platform sends the request link in the notification's `extra`, after the one
  `onAction` listener of the app is registered (it waits for it, so the first notification is
  tracked too).
- A `tap` (the notification itself) whose `extra.link` is a request link (`parseRequestLink`) brings
  the main window forward (`focus_main`) and hands the link to the app's deep-link handlers, the same
  path as a `flightdeck://` link opened from outside. Anything else (another action, no link, a
  pairing link, a non-string) opens nothing and does not bring the window forward.
- No Rust code changes: the plugin and its permission (`notification:default`) already do the rest.
- The older line in `docs/DECISIONS.md` stays as it was (that file is frozen); this file supersedes it.

## Not checked

Only the plugin's reporting is relied on; the click itself is a manual check on Windows (issue #14:
"click a request notification: that request opens"). A toast whose app was closed before the click is
not tracked by the plugin.
