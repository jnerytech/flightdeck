# The Tauri system packages come from a cache (issue #405)

- **Why.** The `System libraries of the Tauri shell (Linux)` step timed out on a slow apt mirror
  (exit 124) three times in two days, the last on main at 772c80060. The deadline and retry of
  #268 only bound the wait; every run still downloaded from the mirror.
- **What.** The package list lives in `.github/tauri-apt-packages.txt`.
  - `actions/cache` (pinned to v4.3.0) keeps the `.deb` files in `~/.cache/tauri-debs`.
  - The cache key is the OS, the architecture, the runner image (`$ImageOS-$ImageVersion`) and the
    list's hash.
  - On a hit, `dpkg -i` installs the saved packages with no mirror at all.
  - On a miss, or when `dpkg` fails, the step falls back to apt with its deadline and one retry.
    apt downloads into the cached folder (`Dir::Cache::archives`), so the next run hits.
- **The runner image is in the key**, because a cache from an older image would install older
  packages over the newer ones the image ships. A new image (about weekly) starts a fresh cache.
- **Ownership.** apt writes the files as root, so the step hands the folder to the runner user,
  who saves the cache after the job.
