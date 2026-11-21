# flightdeckd commands: the document library of a project

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-knowledge-commands.md)

The verbs that read a project's library of PRDs, RFCs, ADRs and specs (the documents with their status, the text a
session is given of them, and whether the project is given it) and the ones that change it: a document's status, a new
document and the feed switch. They work as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share).

## fd knowledge

```sh
fd knowledge list api
fd knowledge list api --json
fd knowledge index api
fd knowledge feed api
fd knowledge set-status api docs/adr/0001-queue.md --status obsolete --hash <hash>
fd knowledge create api adr "Use a queue"
fd knowledge create api rfc "Queue" --body-file draft.md
fd knowledge set-feed api --off
```

A project is its name or its id; an absolute folder also works, and the host refuses one it does not allow (exit `1`).

`list <project>` prints the documents, one line each: the path, the status (`valid`, `transitional`, `obsolete` or
`unclassified`), the type (`prd`, `rfc`, `adr`, `spec` or `-`), the title, the hash of what the list read of the file,
and then what the document adds: the one it `supersedes`, its `problems` and its `warnings`. A list that holds fewer
documents than the project has ends with `more documents than this list holds`; a project with none prints
`no knowledge documents`.

`index <project>` prints the Markdown a session is given of the library, as the host wrote it. When no document
qualifies, or the project is not given the library, it prints `no document is given to sessions`. With `--json` it
carries the text, how many documents it names (`fed`) and whether some were left out (`truncated`).

`feed <project>` says whether sessions in the project are given the index: `on`, or `off` and the folder that switches
it off (the project itself, or one above it). A project that is not trusted is not given the index even when the switch
is on, and the line says so.

With `--json` the commands print one JSON value with `null` for a missing field. The text lines separate their fields
with two spaces and a title may hold some: a script reads `--json`. `--host <name>` reads a paired host.

`set-status <project> <file> --status <status> --hash <hash>` gives a document the status `valid`, `transitional` or
`obsolete`. The hash is the one `list` printed for the file: the command never reads it for you, so a file that changed
since you listed it is refused (exit `1`) and nothing is written. It prints the document as `list` does.

`create <project> <kind> <title>` writes a new document in the project's folder for its kind (`adr`, `rfc` or `prd`),
from the template; it never overwrites one. `--body-file <file>` puts the text of a file under the heading instead of
the template's sections, up to 100000 characters. The host refuses a title with no letter or digit, a document that
already exists and a folder that leaves the project. It prints the new document as `list` does.

`set-feed <project> --on|--off` switches whether the sessions of the project are given the index, and prints where it
stands, as `feed` does. A session that runs this from its shell needs the person's yes whichever way it switches,
because the index is text every session of the project then reads.

When a write gets no answer from the host (exit `2`), the message says the change may or may not have gone in: look
with `knowledge list` (or `knowledge feed`) before trying again.
