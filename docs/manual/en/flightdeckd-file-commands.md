# flightdeckd commands: the files of a repository and the folders of a host

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-file-commands.md)

The verbs that read the files of the repository a session, a card, a terminal or a project works in, and the folders
and files of a host. They work as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share). All but `write` change nothing.

## fd file

```sh
fd file list card:card-1 --dir src
fd file read card:card-1 src/parser.ts
fd file search card:card-1 --mode content --query "TODO"
fd file search card:card-1 --mode name --query env --limit 20
fd file write card:card-1 src/parser.ts --file next.ts --hash <hash> --confirm
fd file dirs /home/me
fd file files /home/me/api --hidden
```

A target is `session:<id>`, `card:<id>`, `terminal:<id>` or `project:<id>`; anything else is refused with exit `1`
before the daemon is asked.

`list <target>` prints the folders and files of one folder of the repository: the root, or the one `--dir` names.
A folder ends with `/`. A file that may hold a credential is listed by name and marked, and it is never read.

`read <target> <file>` prints the size and the hash of the file, then its text, one line at a time. A file over 1 MB,
a binary file and a file that may hold a credential are refused with exit `1` and the daemon's reason, and print no
content. The command prints the whole file: there is no size option. In the plain output a tab or another control
character becomes a space; `--json` prints the text as the host has it, except DEL, the C1 characters and the zero-width characters (a byte-order mark among them), which become spaces there too, so the text may differ from what the hash covers.

`write <target> <file> --file <path|-> --hash <hash> --confirm` replaces the file with the text of `--file`, or of
standard input for `-`, byte for byte. `--hash` is the hash `read` printed: the write goes through only if the file
still has it, so a file someone else changed meanwhile is refused with exit `1` and the daemon's reason, and nothing
is written. A file that does not exist yet, a credential file and a text over 1 MB are refused too. Without
`--confirm`, `--file` or a 64-digit `--hash`, nothing is sent. On success it prints the path, the size and the new
hash, which the next write repeats; `--json` prints `path`, `hash` and `size`. If the connection closes after the
write was sent, the command exits `2` and says the file may or may not have changed: read it again before writing.
`read` is not a copy to edit and send back, since it cleans control characters from what it prints: write from your
own file. A session's own shell cannot run `write` without the person approving it, since the app asks the person
to open the file and save it. Writing anything that steers a session (a file inside any `.claude` folder, such as its settings, agents,
skills, commands and rules, or a `CLAUDE.md` or `CLAUDE.local.md`, however the path is spelled or linked) needs a
near connection (this computer or Tailscale), since it can declare hooks that run in every session: over a far one the daemon refuses with
`transport_refused`. So does a file that has another hard link (it may be a settings file under another name) and the short name of `CLAUDE.local.md` that Windows reads (`CLAUDE~1.MD`). Any other file writes from anywhere.

`search <target> --mode name|content --query <text>` finds files by name or by what they hold. The text has 1 to 200
characters and no control character. `--limit` (1 to 200) caps the matches. Each match is one line: the path, and for
a content search its line and text. A credential file shows up in a name search only, marked as one whose content is
not searched. When there are more matches than shown, the last line says so.

`dirs [<path>]` lists the folders of a folder on the host, and the folder above it. Without a path it lists the
folders the host allows. `files <path>` lists the files of a folder. `--hidden` adds the hidden ones. A relative path
is this machine's current folder; with `--host`, the path is the host's own and must be absolute. A folder outside the
ones the host allows is refused with exit `1`.

With `--json` the commands print the value the daemon returns, with `null` for a missing field and `false` for a
`secret` mark that is not set. `--host <name>` reads a paired host. With no daemon the commands exit `2`.
