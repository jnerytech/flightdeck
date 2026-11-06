# No installer is a download piped into a shell (issue #121, review)

- A fix is now `{ os, command?, url? }`: the package-manager line where one exists (apt, brew, winget, xcode-select) and the official
  install page. The Azure CLI and Tailscale have no one-line package install on Linux, so there the row has only the page; the old
  `curl ... | sudo bash` and `curl ... | sh` lines are gone.
- A test walks every fix of every dependency on the three systems and fails on `| sudo`, `| bash`, `| sh` or `| zsh`. The row shows the
  command to copy (when there is one) and an Install page button that opens the page in the browser; `flightdeckd doctor` prints
  `page: <url>` under the command.
