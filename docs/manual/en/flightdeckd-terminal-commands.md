# flightdeckd commands: terminals

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-terminal-commands.md)

The verbs that read and manage the terminals a host keeps. It works as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share).

## fd terminal

```sh
fd terminal list
fd terminal list --json
fd terminal open --cwd /home/pi/app
fd terminal open --cwd /home/pi/app --cols 120 --rows 40 -- bash -lc "ls -la"
fd terminal open --cwd /home/pi/app --claude --resume <id> --persona <persona>
fd terminal open-session --session fd-qa
fd terminal close <terminal> --kill
fd terminal settings --enable --confirm
fd terminal settings --disable
```

`list` prints the terminals of the daemon, one line each: id, the program it runs, its folder, its size in columns
and rows, `running` or `exited <code>`, how many windows follow it and when it started. A terminal that a "Claude
here" button opened also shows its `launch` id. The program is shown without its arguments. With no terminal the
command says so and exits `0`. With `--json` it prints `{"terminals": [...]}`, as the daemon returns it, with `null`
for a missing field. `--host <name>` reads a paired host. The verb opens no terminal and reads none of their output.

`open` starts a terminal on the host in the folder you name (it must be under an allowed root) and prints `opened`
and the terminal's line. With no more words it runs the host's shell. After `--` come a program and its arguments,
which run as they are, not through a shell. `--claude` runs Claude Code in the folder, resuming a session with
`--resume` and wearing a persona with `--persona`; it does not go with a program. The size is 80x24 unless you give
`--cols` (up to 500) and `--rows` (up to 300). `open-session` opens a shell in the folder the host holds for a
session, named by its name or its id.

`close` detaches a terminal and `--kill` also ends its process. A terminal keeps running after the command that
opened it, so `list` is where you find it again. `settings` turns the host's terminals on or off and prints whether
they are on, how many may run at once and which shell they use. Turning them on gives whoever reaches the daemon a
full shell on the host, so it needs `--confirm`; without it the command exits `1` and sends nothing. A host with the
terminals off refuses `open`.

If a write gets no answer, the command exits `2` and says a terminal may or may not have changed: run `list` before
you try again. Reading what a terminal prints and typing into it stay in the app.
