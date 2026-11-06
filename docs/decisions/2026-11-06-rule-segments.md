# A wildcard inside a name is checked against the sensitive names (issue #435)

`ruleLevel` substituted a whole credential name for each wildcard, so `Write(proj/.cl*/x)` read as
`medium` while covering `.claude/x`, and `Read(proj/.*/x)` as `low` while covering `.ssh`.

Each path segment of a rule that has a wildcard is now also matched, as a glob, against a fixed list
of control and credential names (`SENSITIVE` in `rule-risk.ts`: `.claude`, `.git`, `.github`,
`.husky`, `.vscode`, `.ssh`, `.aws`, `.env*`, `.mcp.json`, `package.json`, `id_rsa`, ...). Each match
makes one more path the rule could stand for, and the existing checks decide: a control file for a
write, a credential for any tool, `any` for the rule. A wildcard in an ordinary name
(`src/app-*.ts`) matches none and stays narrow. The list is a list of what to refuse, so a name not
in it is a gap; the test file names the shapes that are covered.
