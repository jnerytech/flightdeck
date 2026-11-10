# Session trace and replay

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/session-trace-and-replay.md)

The history says what was said; the **trace** says why a run was slow or expensive. It is built
from the transcripts the host already reads (the session's, and the subagents' in
`<session>/subagents/`), so it works for any session on the host, including old ones.

- **Opening it:** the **Trace** tab of a session (**Rastro** in Portuguese), on a host that
  announces `trace`.
- **The tree:** each turn (one per prompt) with, in order, its thoughts, the tool calls and the
  subagents it started; a subagent shows its own tools and subagents under it. Every node has its
  time, its cost and its tokens (a turn's and a subagent's include everything under them), and a
  bar for the time against the longest call of the turn. The turn or subagent that cost most is
  marked **costliest**, and the call that took longest **slowest**. The **Tool** filter keeps the
  calls to one tool and the turns and subagents they sit in.
- **Where the numbers come from:** the time of a call is the gap between the assistant line that
  asked for it and the line with its result, or the real time the telemetry reported when the host
  receives it (see Session timing). Cost and tokens are the ones Costs already computes, once per
  message. A call to the `Task` or `Agent` tool becomes a subagent when its transcript is found,
  by the agent id in the result or by the parent line of the subagent's first record; otherwise it
  stays a plain call.
- **Replay:** **Replay** walks the trace one node at a time: **Previous**, **Next**, **Play** and
  **Pause** at 1x, 2x or 4x. On a host that keeps checkpoints, each step also lists the files its
  turn changed, with the lines added and removed.
- **Export:** **Export trace** saves a JSON with the structure and the numbers only: no prompt,
  tool input, result or thought. With **Include content** the text comes too, and every field goes
  through the secret scan first: a field that holds a secret is replaced by `[redacted: ...]` and
  the number of such fields is shown.
- **Limits:** the transcript format belongs to Claude Code and changes, so a line or field this
  does not know is skipped; a thought appears only when the transcript has it as text.
