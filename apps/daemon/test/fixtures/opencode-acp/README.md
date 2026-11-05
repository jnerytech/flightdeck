# OpenCode ACP fixtures (phase 39)

Recorded on 2026-11-04 from the real `opencode acp` (v2.2.5) with `anthropic/claude-sonnet-5-5`, with the phase 39
config document and `OPENCODE_DISABLE_PROJECT_CONFIG=1`, in scratch folders. One JSON object per line:
`{ "dir": "out" | "in", "msg": <the JSON-RPC message> }`, where `out` is what the client sent.

Scrubbed: the folder became `/work/project`, the session ids `ses_parent` and `ses_child`, and the model list keeps two
entries. Nothing else was edited.

- `tools.jsonl`: one session; `write`, `edit`, `read`, `glob`, `grep` and `shell` approved `once`, `webfetch` answered
  `reject` (the tool fails and the turn ends `cancelled`).
- `child.jsonl`: a scratch config that allows `subagent` (the shipped one denies it): the parent's `subagent` call and a
  child `shell` call with `_meta["opencode/child-session"]` and a `ses_child:` tool call id prefix.

Synthetic fixtures, for shapes the docs define and the shipped config cannot produce, live next to these with the doc URL
in their own README entry.
