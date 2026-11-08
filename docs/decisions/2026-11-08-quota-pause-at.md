# The quota guard is a host setting the app can change (issue #1218)

`quota.pauseAt` ("new cards wait from N%") was only a value in the daemon's config file. The app now
sets it per host with `quota.setPauseAt { pauseAt }`, where `pauseAt` is a number from 0 to 1 or `null`
(the guard is off). The answer is the new `QuotaState`, and every app watching with `quota.watch`
gets a `quota.updated` with the new `pauseAt`.

- **Same rules as `host.keepAwake`**: open to any authenticated client, no confirmation and no
  transport rule. The schema is the check: a number outside 0 to 1, a string or a missing field is a
  `bad_request` (`request_invalid`, field `pauseAt`) and nothing changes.
- **File first**: the daemon writes `quota.pauseAt` to its config file, and only then changes the
  running `Quota`. When the file cannot be written the client gets the error and the guard stays as it
  was, for the client and for the daemon.
- **Gate `quotaPause`**: a host without the setting answers `feature_off` and does not list
  `quotaPause` in the features of `host.info`; the app hides the control then.
- **Running sessions are never touched.** The guard only decides whether a new card starts.
