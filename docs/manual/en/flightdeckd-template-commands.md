# flightdeckd commands: task templates and what a task made

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-template-commands.md)

The verbs behind simple mode's task templates, and the host's harness templates: list the templates, start a task from
one, list and read the files a task made, and list or delete a saved harness template. They work as the other
`flightdeckd` commands do: see [what they all share](flightdeckd-commands.md#what-they-all-share). Two verbs change
something: `template start` starts a session and `harness templates delete` removes a folder from the host.

## fd template

```sh
fd template list
fd template list --json
fd template start summarize --field folder=/w/docs --field tone=formal --name "Docs summary"
fd template start summarize --field folder=/w/docs --language pt-BR --json
```

`list` prints a line per template (`summarize  Summarize a folder  read_only`: the id, the title and the permission
preset), then a line per field below it (`  field tone  choice  formal, casual  (optional)`: the field's id, its kind, the
options of a choice and whether it can be left out). A template file that did not load prints
`problem  <file>  <reason>` after the templates.

`start <template>` starts a Claude session on the template. Every field the template asks for is given with `--field
<id>=<value>`, once per field (a path for a folder or a file, a text, or the id of an option; a value may contain
`=`; a folder or file is an absolute path, since the daemon has a folder of its own, and a relative one is refused
before anything starts). `--language en|pt-BR` picks the language of the prompt (default `en`) and `--name` names the task (1 to 100
characters). It prints `started  <session>  <permission mode>  working <folder>  results <folder>`; with `--json` it
prints the whole answer. The daemon checks the template and the values: an unknown template, a missing value or a
folder outside the allowed roots is a refusal with its text and exit 1. A connection lost while it starts says the task
may or may not have started: look at `fd sessions` before you start it again.

From a session's own shell, `template start` is rated high: the app asks the person to confirm it, and a shell only
types words.

## fd task

```sh
fd task results docs-task
fd task results docs-task --json
fd task preview docs-task "/w/docs/Flightdeck results/summary.md"
```

A session is its id or its name. The path of `preview` is absolute, as `results` prints it. `results` prints a line per file the task made or changed (`new  1234 B  <time>
<path>`) or `no files yet`. `preview` prints the start of one of those files as plain lines; the daemon refuses a path
that is not a result of the task. A list or a text cut short for size says so on stderr (`cut short`), so stdout stays
what a script reads. Control characters in a file's text are replaced by spaces. `--json` prints the daemon's answer
whole. Both only read.

## fd harness templates

```sh
fd harness templates list
fd harness templates delete node-api --confirm
```

`list` prints a line per saved harness template: the id, the title, the number of files and the size in bytes
(`node-api  Node API  2 files  2048 bytes`), never a content, or `no harness template on this host`.

`delete <template> --confirm` removes the template's folder from the host and prints `deleted harness template
<id>`. Without `--confirm` the command refuses before it connects. The daemon deletes only inside the harness
templates folder and only over a near connection (this computer or a private tailnet address): any other address is refused. A connection lost while it
deletes says it may or may not have been deleted: list the templates to see. From a session's own shell it is rated
high.
