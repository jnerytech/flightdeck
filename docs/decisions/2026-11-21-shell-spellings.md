# Spellings of a flightdeckd line that the risk rules read (issue #3570)

The risk rules read a shell command as text (#3499, #3559, #3566). #3570 listed the spellings that
real bash runs as a `fd` verb and the rules still read as an ordinary command. Each was checked by
running the line through bash with a fake `fd` that logs its arguments, before and after.

## Read as the verb now

- A redirection before the program (`2>&1 fd persona remove qa`): the `&` of `>&` and `&>` no longer
  cuts the line into two commands.
- A prefix assignment that appends (`A+=x fd ...`) or whose value holds an escaped blank
  (`A=x\ y fd ...`).
- Blanks after a backslash, counted one by one (`fd --message a\ b\  persona remove qa`): the
  quote-aware read now cuts words with the shell's own rule instead of on every blank.
- A brace range that opens the program word (`{f..f}d ...`): only a bare `{` opens a group.
- A word the shell expands in a `history resume` line (`F=--force; fd history resume s $F`) is read as
  the `--force` flag it may be. `fd history resume $SID` is high for the same reason: the variable
  may hold more than an id.
- A runner given the CLI and a noun the shell expands (`bun run start $V c1`, `bun bin.ts $V c1`).
  `bun run start $ARGS` in another project is read the same way: the script is named like the CLI's.
- A noun that a rule reads and the verb check did not know (`fd ssh $V h`). A test now reads the nouns
  from `risk.ts` and checks each one.
- Words that `xargs` appends (`echo persona remove qa | xargs fd`): a line that stops before its verb
  is high when `xargs` runs it.

## Left out, with the reason

- A renamed copy of the binary (`cp $(command -v fd) ./x; ./x persona remove qa`). No text names the
  CLI, so no rule over text can read it. The proof of a device (#3439) is the guard.
- An unresolved program followed by an expanding noun (`$X $N remove qa`). Reading it as the CLI makes
  every `$EDITOR $FILE` high.
- Extended globs (`@(fd)`, `+(f)d`) and a glob that names a file in the working folder (`f[d]`): the
  shell matches them against files, not against the commands on `PATH`, so they run only when such a
  file sits in the current folder and `shopt -s extglob` is on.
- `fd fd --host h approve r1` and `flightdeckd fd --host h approve r1` stay high: the parser sends the
  first to claude, the second to the CLI, and over-rating a harmless line costs one question.
