# flightdeckd commands: terminals

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-terminal-commands.md)

The verb that reads the terminals a host keeps. It works as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share).

## fd terminal

```sh
fd terminal list
fd terminal list --json
```

`list` prints the terminals of the daemon, one line each: id, the program it runs, its folder, its size in columns
and rows, `running` or `exited <code>`, how many windows follow it and when it started. A terminal that a "Claude
here" button opened also shows its `launch` id. The program is shown without its arguments. With no terminal the
command says so and exits `0`. With `--json` it prints `{"terminals": [...]}`, as the daemon returns it, with `null`
for a missing field. `--host <name>` reads a paired host. The verb opens, reads and writes no terminal.
