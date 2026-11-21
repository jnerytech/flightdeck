# flightdeckd commands: the review comments

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/flightdeckd-review-commands.md)

The verbs that read and write the inline comments on a diff. They work as the other `flightdeckd` commands do:
see [what they all share](flightdeckd-commands.md#what-they-all-share). `list` changes nothing; `add`, `update`,
`remove` and `send` change the drafts of a target or send them. The app's own flow is in
[Reviewing changes](reviewing-changes.md).

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

## Writing the comments

```sh
fd review add card:card-1 --path src/a.ts --lines 10-12 --body "why this?"
fd review update c1 --body "why this, and not a map?"
fd review remove c1
fd review send card:card-1 --confirm
```

- `add <target> --path <file> --lines <n|a-b> --body <text> [--side new|old]` keeps a draft on those lines of the
  file. The side is `new` unless `--side old` says otherwise. It prints `added <id> <file>:<lines> <side>`. The host
  refuses lines the file does not have, and the `project:` target, with its text and exit `1`.
- `update <id> --body <text>` changes the text of a comment and prints `updated <id> ...`. A comment the host no longer
  has is exit `1` with `comment <id> no longer exists`.
- `remove <id>` deletes a comment and prints `removed <id>`. The host does not say whether the id existed, so a
  `remove` of an unknown id prints the same line.
- `send <target> --confirm [--language en|pt-BR]` puts the drafts of the target into its session, card or terminal as
  one message, as the app's Send review does, and prints `sent <n> comment(s) to the <session|card|terminal>`. When
  nobody can take the message it says so and prints the review, so it can be copied. `--confirm` is required since
  it sends text into a session.

Each verb takes `--json`, which prints what the host returns, and `--host <name>`. A write that gets no answer exits
`2` and says what to look at before repeating it: run `review list` on the target. From a session's shell, `send` is a
high-risk command, and so are `update` and `remove`, since they can rewrite or erase a draft the person wrote: the app
asks the person first. `list` and `add` are ordinary.
