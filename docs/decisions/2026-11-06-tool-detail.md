# A stored tool call is read from its transcript when its row opens (issue #606)

## Context

The transcript reader showed each tool call as one line: `[tool Name] <first field, 80 chars>`, which the indexer stored in `history_messages`. The full input was dropped at parse time, and so was every `tool_result`. The live view's `ToolCall` opens to both.

## Decision

- A `history.tool {claudeSessionId, uuid, index}` command, behind a `history.tool` feature. The daemon streams the session's own transcript, the file the indexer recorded in `history_sessions.file_path` and never a path the client names. It takes the `index`-th `tool_use` of the line `uuid`, then the `tool_result` with that `tool_use_id` in the lines after it, and stops there. It returns the name, the input, the result (`null` while there is none) and `truncated`.
- The input and the result are each cut to 64 KiB of UTF-8 (`MAX_TOOL_BYTES`). A cut input comes back as its pretty JSON text.
- The reader's `ToolRow` becomes a disclosure (a button with `aria-expanded`, opened by click, Enter or Space). It reads the call on the first open, and renders the input and the result with `ToolCallBody`, shared with the live `ToolCall`. A host without the feature keeps the plain row.

## Discarded alternative

- **Store the input and result in the index** (a `history_tools` table). `history.get` could then return them at once, but it needs a migration, a reindex of every transcript already indexed (the index is incremental), and room for every call of every session. Reading on open costs one file stream per opened row, and only for the rows a person opens.

## Consequences

- The result's content is what the transcript holds, secrets included, in a file the person already owns. Nothing new is read or stored.
- The row finds its call by the message `uuid` and the tool's place among that message's tool lines. A stored message cut at 8 KiB loses its later tool lines, and those rows are not shown, as before.
