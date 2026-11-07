# The secret scanner names kinds, not labels (issue #714)

`SecretScanner.scan` used to return Portuguese labels ("token do GitHub", "senha na linha"…),
which reached an English screen as they were. It now returns stable kinds (`SECRET_KINDS` in
`packages/protocol/src/snippets.ts`: `github_token`, `sk_key`, `aws_key`, `private_key`,
`bearer_token`, `slack_token`, `password_line`, `url_credential`, `password_option`,
`curl_password`, `authorization_header`, `cookie`, `basic_credential`, `jwt`, `service_key`,
`webhook`, `signed_url`, `url_token`, `vault_value`).

- The app names each kind from its dictionaries (`secretKind.*`, both languages). A kind it does
  not know stays as the host sent it, so an older app against a newer daemon shows the id and a
  newer app against an older daemon shows the old label.
- The fields that carry them keep their names (`secrets.labels` of a teleport manifest,
  `flagged` of a history candidate, the `kinds`/`found`/`labels` params of a refusal): only the
  values change, so the protocol baseline ratchet is untouched.
- The refusals of a persona, a PR (description, title, merge message), a snippet and the
  assistant, and the hidden lines of the history import, name the kinds through
  `secretKindsText`. The daemon's own English messages and the trace export's
  `[redacted: …]` carry the ids.
