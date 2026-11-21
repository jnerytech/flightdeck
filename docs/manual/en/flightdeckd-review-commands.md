# flightdeckd commands: the review comments

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-review-commands.md)

The verbs that read the inline comments a person left on a diff. They work as the other `flightdeckd` commands do:
see [what they all share](flightdeckd-commands.md#what-they-all-share). They change nothing. Writing a comment and
sending the review to the session stay in the app: see [Reviewing changes](reviewing-changes.md).

## fd review

```sh
fd review list card:card-1
fd review list session:s1 --json
```

`list <target>` prints the comments on the diff of a target, which is `session:<id>`, `card:<id>`, `terminal:<id>` or
`project:<id>`. Each comment is one line: its id, the file and the lines it covers, the side of the diff (`new` or
`old`), and its state (`draft` or `sent`), with `outdated` when the quoted lines are no longer in the file and the
author and severity of a second opinion's finding. The comment's text follows, indented. A target with no comment
prints `<target>: no comments` and exits `0`. A target the host refuses exits `1` and says why.

With `--json` the command prints the value the daemon returns, with `null` for `author` and `severity` when a comment
has none. `--host <name>` reads a paired host.
