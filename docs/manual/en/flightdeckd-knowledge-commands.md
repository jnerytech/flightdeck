# flightdeckd commands: the document library of a project

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-knowledge-commands.md)

The verbs that read a project's library of PRDs, RFCs, ADRs and specs: the documents with their status, the text a
session is given of them, and whether the project is given it. They work as the other `flightdeckd` commands do: see
[what they all share](flightdeckd-commands.md#what-they-all-share). Changing a status, creating a document and the feed
switch stay in the app.

## fd knowledge

```sh
fd knowledge list api
fd knowledge list api --json
fd knowledge index api
fd knowledge feed api
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
