# The two ways round the hold: a swapped input and a rule that covers more (issue #384)

Found by the security-reviewer on #251. An approval is for what was asked, and a saved rule is a
promise about every call it will match; both were open before.

- **The approval is for the exact input.** `permission.respond` may carry `updatedInput`, and the
  daemon passed it to the process unchecked, so an allow of `ls` with `{ command: "rm -rf ~" }` ran
  `rm -rf ~` with no hold (the risk had been judged on `ls`). Now `bindInput`
  (`permissions/bind-input.ts`) refuses an `updatedInput` that is not the input that was asked
  (keys in any order are the same input), with the reason `input_changed`, and the request stays
  open. The one exception is `AskUserQuestion`, whose answer is `updatedInput.answers`: it may add
  `answers` (an object of strings) and change nothing else, so the questions cannot be rewritten.
  A deny ignores it. For an external session the check is against the whole input the hook sent,
  kept apart from the frame, whose copy is cut at 200 characters for the queue.
- **A rule cannot cover more risk than its request, and an open one is an allowlist.** A project
  rule that is not one of the request's own suggestions (the CLI offered those) is judged by
  `ruleLevel` (`permissions/rule-risk.ts`). Its first version appended the worst arguments it could
  think of to the prefix and asked the classifier; the security review showed that a denylist does
  not keep up (`cat:*` reads a credential, `env:*` and `timeout:*` run `rm -rf`, `find:*` and `dd:*`
  destroy, `Read(~/**)` reaches `~/.ssh`), so a rule is now narrow only when it is shown to be, and
  `any` (refused at every risk, held or not) otherwise:
  - A shell rule with no wildcard is the command it names, classified as it is: it must not be
    higher than the request.
  - A shell rule with a wildcard is saved only as a trailing `:*` or ` *` after one of a few
    read-only forms: `git status|diff|log|show`, `npm|pnpm|yarn|bun test`, `npm|pnpm|yarn|bun run
    <script>`. Any other program, a wildcard anywhere else (`r*`, `git * origin`, `* *`), shell
    syntax in the prefix, and the whole tool (`Bash`) are `any`.
  - A file rule (the read and write tools) is a path as the CLI reads it (`//abs` is absolute, a
    single leading `/` is the project's root, the rest is relative to the folder). With no wildcard
    it is that file, classified. With `*`, `**` or `?` the pattern is turned into a regular
    expression and tried on the names a credential has under its folder (`.env`, `id_rsa`, `*.pem`,
    `*.key`, `.ssh/id_rsa`, `.aws/credentials`, `.config/gh/hosts.yml`): a pattern that can match one
    is `any`. So `src/**` is refused (it matches `src/.env`), and `src/**/*.ts` and `src/*.ts` are
    saved. Character classes, braces, `!`, `..`, backslashes with a wildcard, and the whole tool are
    `any`.
  - A network tool needs a domain: the whole tool would reach any host.
  - Any other tool (an MCP tool) is what the classifier says of it with no input.
  A request that is high and was held may still save an exact command that is high, and nothing
  open: the hold covers that one request, not a standing permission.
- **The app's default rule** for a tool that names a file or a folder is that path, written as the
  CLI reads it: relative to the request's folder when it is inside it (`Edit(src/a.ts)`, `LS(.)`),
  `//` and the path when it is absolute outside it (a single leading `/` would mean the project's
  root, and the rule would never match). Bash keeps its exact command and the others their name.
  The person can still edit the rule into a pattern, which the daemon then judges as above.
- **Known limits.** An open rule on a form of the allowlist can still read what the classifier
  calls ordinary (`git show` prints any file of the repository, `.env` included, when it is
  committed). `*` in a path is read as `[^/]*` and `**` as anything: the CLI's own matcher is the
  authority, and a contract test against the pinned CLI is a follow-up. A shell rule is read as one
  command (the CLI splits compound commands before it matches a rule). The suggestions of an
  external session come from its hook (`hooks.token`), and are trusted as the CLI's; whoever holds
  that token is the user. `held` is still the client's own assertion (#251). Not changed: an
  unknown tool is `medium` in the classifier, and the `.claude/`, `.git/hooks` and workflow files
  are ordinary writes there.
