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
  - A shell rule with a wildcard is saved only as a trailing `:*` or ` *` after one of three
    forms: `git status`, `npm|pnpm|yarn|bun test`, and `npm|pnpm|yarn|bun run <script>` where the
    script starts with a letter, a digit or `_` (so `--prefix`, `--cwd`, `./x.js` and `evil.ts` are
    not scripts). `git diff`, `log` and `show` are not open: they take `--output` (git writes a
    file), `--no-index` (any file), and run the programs `.git/config` names. Any other program, a
    wildcard anywhere else (`r*`, `git * origin`, `* *`), shell syntax in the prefix, and the whole
    tool (`Bash`) are `any`.
  - A file rule (the read and write tools) is a path as the CLI reads it (`//abs` is absolute, a
    single leading `/` is the project's root, the rest is relative to the folder). With no wildcard
    it is that file, classified. With `*`, `**` or `?` the pattern is **instantiated**: each
    wildcard in turn stands for each name a credential has (`.env`, `id_rsa`, `x.pem`, `x.key`,
    `.ssh`, `.aws`, `credentials`; a `?` for each character; a `**/` for nothing or a folder with
    those names), the others for `x`, and then all alike. Every instance goes to the daemon's own
    classifier, and a pattern with one that is high is `any`. So a wildcard in a folder
    (`packages/*/.env`, `*/.ssh/*`), an extension (`src/*.ts` matches `src/.env.ts`, and `*.PEM`
    any case) and `src/**` are refused, and `src/app-*.ts` or an exact file are saved. That removes
    most useful wildcard file rules on purpose: the CLI's own session suggestions (`acceptEdits`, a
    folder) are not judged here, and the exact default is one click.
  - **Control files** never get a standing permission to be written: `.claude/`, `.git/`,
    `.mcp.json`, `package.json`, `.husky/`, `.github/workflows/`, `.vscode/tasks.json`. A session
    that could rewrite its own allow rules, a hook, or a script a test run starts would end every
    hold with one approval. Reading them is fine.
  - Character classes, braces, `!`, `..`, backslashes with a wildcard, and the whole tool are `any`.
  - A network rule needs `domain:` and a host with two labels or more, one `*.` at most
    (`domain:example.com`, `domain:*.example.com`); the whole tool, `domain:*` and `domain:com` are
    `any`.
  - Any other tool (an MCP tool) is what the classifier says of it with no input.
  A request that is high and was held may still save an exact command that is high, and nothing
  open: the hold covers that one request, not a standing permission.
- **The app's default rule** for a tool that names a file or a folder is that path, written as the
  CLI reads it: relative to the request's folder when it is inside it (`Edit(src/a.ts)`, `LS(.)`),
  `//` and the path when it is absolute outside it (a single leading `/` would mean the project's
  root, and the rule would never match). Bash keeps its exact command and the others their name.
  The person can still edit the rule into a pattern, which the daemon then judges as above.
- **Known limits (second security review).** An open `npm test`, `bun test` or `run <script>`
  executes what the project defines: `package.json` (a control file, so the session cannot write
  it under a standing rule), but also test files and `--preload`, which it can write as ordinary
  medium writes; after one approved edit the open rule gives it arbitrary execution. There is no
  rule-level fix: the answer is not to save those forms from a request the person did not read.
  Not judged here: a bare folder name in a rule (`Read(src)` may match the subtree in the CLI's
  gitignore matching), compound commands, `$()` and redirects after a saved prefix (the CLI splits
  and checks them), `git difftool` against the CLI's word boundary, symlinks (the classifier is
  lexical), the Windows and UNC forms in the app's default rule, and file names that contain a
  wildcard character. A contract test against the pinned CLI's matcher is the follow-up for all of
  them. The suggestions of an external session come from its hook (`hooks.token`) and are trusted
  as the CLI's; whoever holds that token is the user. `held` is still the client's own assertion
  (#251). An unknown tool is `medium` in the classifier.
