# Subagent delegation (token-saving focus)

Goal: spend fewer tokens on the main model. The general rule is to **delegate reading and searching to Haiku** and **do everything else directly in the main session**.

## Which subagent to use

| Situation | What to do | Model |
|---|---|---|
| Find files, understand how something works, map where something is used | `Explore` | **always `model: haiku`** |
| Context gathering during plan mode | `Explore` (not `Plan`) | **`model: haiku`** |
| Architectural analysis: dependencies between modules, impact of a large refactor, comparing approaches | `Plan` | **`model: sonnet`** |
| Small or medium edit, with the files already identified | **Do it directly**, no subagent | — |
| Mechanical, repetitive task across many files (renaming, applying a pattern, fixing tests) | `general-purpose` | **`model: sonnet`** |
| Long, complex task that would fill up the main context | `general-purpose` | default |

Rules:
- Every `Explore` call must pass `model: haiku` explicitly.
- Use `general-purpose` sparingly: it starts cold, rereads files and is expensive. Only use it when sparing the main context is worth that cost.
- **Do not delegate** when the file path is already known or a single `Read`/`Grep` is enough. Do it directly.
- Do not reread in the main session files that `Explore` already summarized, except for the sections you are about to edit.
- Independent search tasks: launch several `Explore` calls in parallel, in a single message.

## Plan mode

Rework is the biggest waste of tokens. Therefore:

- For every medium or large task (more than one file, a behavior change, a non-obvious approach), enter plan mode and present the plan before editing anything.
- Exception: a session that works autonomously (it receives its tasks by message from an orchestrator or a scheduled prompt, and the person is not at the terminal) does not enter plan mode, because leaving it needs the person's approval and the session would sit waiting. It writes the same short plan (files, approach, risks, validation) as a comment on the issue or in the PR body, and goes on.
- Inside plan mode, context gathering goes to `Explore` with `model: haiku`, not to `Plan`.
- Use `Plan` with `model: sonnet` only when the plan depends on real architectural analysis. Never use it just to locate files.
- The plan must list: files to change, the chosen approach (and why, if there was an alternative), risks, and how to validate.
- Small, obvious tasks do not need plan mode.

## Explore thoroughness level

Choose the level and state it in the prompt. Start with the lowest level that does the job:

- **quick** — targeted lookup with a clear target: "where is X defined", "which file configures Y".
- **medium** — understand a flow or module: "how does authentication work", "who calls this service".
- **very thorough** — broad sweep: impact of a change across the whole codebase, varied naming conventions, code spread across several projects or layers.

If a `quick` search comes back inconclusive, move up to `medium` instead of repeating the same search.

## How to write the subagent prompt

`Explore` and `Plan` **do not read this CLAUDE.md** or the session's git status. Everything they need to know must be in the prompt. Use this structure:

```
Goal: <what I need to find out and why — which decision this will support>
Thoroughness: <quick | medium | very thorough>
Project context: <stack, relevant folder structure, naming conventions>
Where to look: <likely folders/files>
Ignore: <legacy, generated, vendor, tests — whatever is irrelevant>
Already known: <what has already been found, to avoid repeating it>
Response format: list of path:line with one sentence each, at most 15 lines, no pasted code
```

The short response format is mandatory: it is what keeps the main context small.

For `general-purpose`, which does read this file, focus on the goal, the definition of done and the constraints ("do not change the public API", "run module X's tests at the end"), and ask for a short report: what changed and what is still pending.

## After the subagent returns

- Open only the cited sections you are going to edit or that back a critical decision.
- Do not paste the subagent's output to me; summarize what matters for the decision.
