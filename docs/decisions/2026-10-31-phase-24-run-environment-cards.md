# Phase 24 decisions: the run environment of the cards (phase 24)

## Daemon (`run-config`, `portas`, `run-execucao`, `run-processos`, `preview`, `run-protocolo`, `run-daemon`)

- **Non-concurrent mode in the file:** the spec says "per project". It is `exclusive: true` in the `run.yaml`, which is versioned, shared by the team and trusted by hash, and needs no new `Project` field, protocol change or settings form. A project without the key allows concurrent cards.
- **Where it is read from:** the file of the base branch (`git show`), never the card's worktree, like the workflows: an agent could write the file in its own branch. The trust is the hash of that content (`trusted_run_configs`); a new commit on the base branch drops it until it is reviewed again. Nothing a run.yaml declares runs before that (`RunConfigs.resolve`).
- **Commands are argv:** a text for a shell is a schema error. `ready.http` must be http(s) on `127.0.0.1` or `localhost` with no credentials, checked in the file, in `isPreviewUrl` (protocol package, shared by daemon and app) and in the app's CSP.
- **Ports:** a block of 10 per card from `run.portBase` (1024 up to 65526, so the last block fits; 41000 by default), taken in turn under a queue so two cards never pick one, skipping a block with a port busy on the machine (the real probe listens through `node:net` on the loopback). The reservation is a row (`card_ports`) that survives a restart and goes when the card reaches done, through `board.watch`. The tests never use fixed ports: an injected probe, and an operating-system port for the real probe.
- **The setup runs once per card:** `card_setup_done`, so a restarted daemon does not repeat it; a failed setup is not marked and the next Run tries it again. It runs in a terminal tab like the processes.
- **Processes are terminals:** the real host opens each through the host's `TerminalManager` (a real PTY, no shell, the cwd checked against `allowedRoots`). A host with the terminals off, or at its limit, fails the run with the reason and ends what had started, instead of an unhandled rejection.
- **Stop kills the tree first:** SIGKILL to the process group (the PTY's child leads its own, which a test pins; the daemon's group is another one) or `taskkill /PID n /T /F`, then ends the terminal. The kill of the leader alone would leave children that ignore SIGHUP and SIGTERM. `killTree` refuses the daemon's own pid, init and a pid that is not one. The test starts real processes that ignore both signals and checks they go while the test process and a sibling stay.
- **Preview readiness:** any HTTP answer counts (a 404 is a server that is up); probes every 500 ms for a minute. A process that ends is no longer a preview.
- **Terminal manager:** it now reports the exit code to `onExit`, exposes `pidOf`, and the Bun PTY gives its pid.
- **Protocol:** `runenv.config/trust/start/stop/get/watch`, the `runenv.updated` frame and the `runenv` feature in `host.info`. `run.*` was taken by the workflows, hence the name.

## Interface (`run-ui`, `preview`)

- **The panel is the card's:** the "Run environment" panel is on the card screen when the host has `runenv` and the project has a run.yaml; it lists the commands to review, trusts after a question, then Run, Stop, the state, the ports, a log button per process (its terminal tab, and the setup's) and **Open preview** once a process answers. "Run" and "Stop" keep their English names in both languages, as the spec writes them.
- **Preview:** a route and a tab with a frame (`sandbox="allow-scripts allow-forms allow-same-origin"`, no referrer, no top navigation). The address is checked again on screen because it comes from a route. The preview tab is not kept between starts (its address may belong to another program by then), and **Open in browser** goes through `openLink`.
- **CSP:** `frame-src http://127.0.0.1:* http://localhost:* https://127.0.0.1:* https://localhost:*`, nothing wider; `[::1]` is left out in the app's check as well. The tauri-rust-reviewer accepted it: the IPC stays closed to a framed page (the capability is granted by window label, with no `remote`). Noted by the reviewer and left out: in a dev build a run.yaml pointing at the dev server's own port would frame the app itself.
- **No credentials in an address:** refused in the file and by `isPreviewUrl`, as the reviewer suggested.
- **The test file is `run-ambiente-ui.test.tsx`:** `run-ui.test.tsx` already belongs to the workflow runs of phase 6.

## Smoke

- **`smoke:run`:** a real daemon over a real repository whose committed run.yaml runs an echo server that also starts a child that ignores SIGHUP and SIGTERM. Two cards run at once on different blocks, both answer over HTTP, and Stop leaves no server, child or answering port. Its block starts at a random base. Red on the base commit, where `runenv.config` does not exist.
