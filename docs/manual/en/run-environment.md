# Run environment

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/run-environment.md)

With several worktrees at once, running the app of two cards breaks on the ports. The run
environment gives each card **scripts** to prepare and run it, **a block of ports of its own** and
a **preview** of the running app. It completes the `.worktreeinclude` (which brings the files in)
with the half that runs. It needs a host with the terminals on (see
[Tabs and embedded terminal](tabs-and-embedded-terminal.md#tabs-and-embedded-terminal)), since each process opens in a tab.

## The run.yaml

A project declares it in `.flightdeck/run.yaml`, committed on the base branch (the file in a
card's worktree is never read: an agent could write it).

```yaml
setup: ["bun", "install"]
run:
  - name: web
    cmd: ["bun", "run", "dev", "--port", "{{port.web}}"]
    ready: { http: "http://127.0.0.1:{{port.web}}/" }
  - name: api
    cmd: ["bun", "run", "api"]
    env: { PORT: "{{port.api}}" }
ports: [web, api]
exclusive: false
```

- Commands are **lists** (argv), never a text for a shell: a plain text is an error. They run in
  the card's worktree.
- `setup` runs once per card, before the first Run. `run` lists the processes.
- `ports` names the ports of the card's block, in order. `{{port.<name>}}` becomes the port in a
  command, a variable or the ready address, and `FLIGHTDECK_PORT_<NAME>` (upper case, `-` as `_`) is
  in every process's environment.
- `ready.http` is the address that tells the app the process answers. It must be http(s) on
  `127.0.0.1` or `localhost`, with no user or password.
- `exclusive: true` is the **non-concurrent mode** of the project: one card runs at a time, and a
  second Run is refused until the first stops.

## Trust

Nothing the file declares runs before you trust it. The card's **Run environment** panel lists the
commands; **Trust this run.yaml** asks, and trusts that exact content (its hash). When the file
changes on the base branch the trust is gone until you review it again. A file with errors shows
them and offers neither Trust nor Run.

## Ports

Each card holds a block of 10 free ports starting at `run.portBase` of the daemon's config (41000
by default; between 1024 and 65526). Blocks are taken in turn, never two cards in one, and a block
with a port in use on the machine is skipped. The block is the card's until it is done, even
between Runs, and survives a restart of the daemon.

## Run and Stop

On a card with a worktree, **Run** runs the setup (if it did not run yet) and then each process,
each in a terminal tab of the host. The panel shows the state (setup, running, ended, failed), the
ports, and for each process its state and **View log**, which opens its tab. A failed setup shows
its exit code and Run tries it again. **Stop** ends the whole tree of each process, including
children that ignore signals (the process group on Linux, `taskkill /T` on Windows). A card that
reaches done stops by itself and gives its ports back.

## Preview

When a process's `ready.http` answers (any HTTP answer counts, even a 404) its row gets **Open
preview**, which opens a **Preview** tab with the app in a frame. The preview only opens
`127.0.0.1` and `localhost` (the address is checked in the daemon, in the app and by the app's
CSP, whose `frame-src` allows only those), is not kept between starts, and **Open in browser**
sends the same address to the system browser. If the process does not answer in a minute the row
says so.
