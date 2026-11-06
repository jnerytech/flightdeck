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
- **A rule cannot cover more risk than its request.** A project rule that is not one of the
  request's own suggestions (the CLI offered those) is now judged by `ruleLevel`
  (`permissions/rule-risk.ts`) with the daemon's own classifier: the most risk any call the rule
  matches could have, and it is refused (`invalid_permission_update`, reason
  `perm_rule_too_broad`) when that is higher than the request's. How a rule is read:
  - A shell rule with no wildcard is the command it names, classified as it is.
  - With a wildcard (`git:*`, `rm *`) or none at all (`Bash`), any arguments may follow, so the
    prefix is classified with the worst ones appended: `-rf /`, `-R /`, `/s /q`, `-Recurse -Force`,
    `push --force`, `reset --hard`, `clean -fd` (and `-EncodedCommand` for a PowerShell, and for the
    blanket rule). So `git:*`, `rm:*`, `chmod:*`, `sudo:*` and `Bash` are refused from a request
    that is not high, and `git status:*`, `npm test:*` and `npm run build:*` are saved.
  - A file tool's rule is a path: a blanket one, one with a leading wildcard, one with `..`, and
    one that reaches a credential or leaves the allowed folders are high; one inside the project is
    not. The same for the read tools.
  - Any other tool is what the classifier says of it with no input (an MCP tool that deletes is
    high, the rest medium).
  A request that is high and was held may save a rule up to high: the person held the button.
- **The app's default rule** for a tool that names a file is that file (`Write(src/a.ts)`), no longer
  the tool's name, which the daemon now refuses; Bash keeps its exact command and the other tools
  their name. The person can still edit it into a pattern.
- **Known limits.** The classifier knows commands by what it can see: a rule on a program that can
  run anything (`bash:*`, `python:*`, `node:*`, `npx:*`) is medium for it, as the request itself
  would be, so it is not refused here; that is the classifier's policy (#384 does not change it). A
  shell rule is read as one command: the matcher of Claude Code splits compound commands before it
  matches a rule, and this check assumes it. `held` is still the client's own assertion (#251).
