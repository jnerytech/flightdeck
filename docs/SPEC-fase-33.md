# Flightdeck — Phase 33 spec (Simple mode for people who do not use the terminal)

## Goal

Flightdeck speaks Claude Code: sessions, personas, permission modes, worktrees, hooks, tokens, a terminal. That is right
for developers and wrong for a business team that wants "summarise this folder" or "draft the monthly report" and has
never opened a shell. Today such a person meets a wall of controls on the session screen, approval cards that name tools,
and a transcript full of tool calls.

This phase adds a **simple mode**: a presentation layer over the same daemon. In it the person starts a **task** from a
**template**, answers plain **yes/no questions** that say what will happen, and gets the **result as files and a short
summary**, not a transcript. The full app stays one switch away.

The switch is **per user** (a choice in the app) with a **per-host default** (an administrator sets a host to simple, and
may lock it). Nothing changes for anyone who does not turn it on: the default is full mode everywhere.

Origin: user request relayed on 2026-11-03 (todo item 14). Research: `flightdeck-handoff/simple-mode-research.md`
(Cowork, ChatGPT agent mode, Copilot coding agent, Devin, Happy). Prerequisites: Phase 4 (board), Phase 6 (workflows),
Phase 8 (budgets), Phase 29 (states and layout primitives), Phase 32 (calm chrome and motion tokens). It also builds on
the approval card with risk levels, the host's allowed folders and `plan` permission mode.

**Out:**

- Real access control. Simple mode **hides**; it does not **protect**. The host's allowed folders, budgets, vault rules
  and permission rules keep deciding, in both modes. Locking a host to simple is a convenience for an administrator, not
  a security boundary (a person with the daemon token can still speak the protocol).
- A separate app, a web version or a phone layout (desktop only, as the product direction says).
- Editing templates in the app (host templates are files; see Design). No template marketplace.
- Sharing results outside the machine (email, cloud drives, links).
- Scheduled or recurring tasks (automations and workflows exist; a template may feed them later).
- Teaching Claude Code: no tutorial, no glossary screen. The words are simply different.

## Design

### The mode and who decides it

- **Effective mode** = the person's own choice if they made one, else the host's default, else `full`. The mode is
  resolved **per host** because the app shows several hosts: opening a host set to simple shows simple mode for that host
  even when the person's default is full, unless they chose otherwise.
- **Host default**: a setting in the daemon config (`ui.mode` = `simple` | `full`, and `ui.locked` = true | false),
  returned in the host's info and changed with a new action that needs the same trust as other host settings.
- **Lock**: when `ui.locked` is true the app does not offer the switch for that host. The daemon does not enforce it.
- **Person's choice**: stored in the app (like the theme), one value for all hosts or per host. Per host is the safer
  reading of "a business team on one host, a developer on another".
- **The switch** is one item in the simple settings and one item in the full settings; in simple mode it reads "Show
  everything" and leads through a one-line confirmation ("This shows the technical screens").
- **Window title and tray** follow the mode of the host that raised them.

### Vocabulary

One dictionary layer, `simple`, that overrides the strings of the shared screens and adds the new ones (both languages,
never a literal in a component). The main renames:

| Full mode | Simple mode |
| --- | --- |
| session | task |
| needs you | waiting for your answer |
| persona | style (hidden unless a template sets it) |
| permission request | question |
| end session | stop the task |
| host / project | computer / folder |
| cost, tokens, budget | hidden; when a budget stops a task: "This task stopped: the spending limit was reached." |

Never shown in simple mode: tool names, JSON, session ids, worktree and branch names, hooks, MCP, plugins, vault,
permission-mode names, the terminal, "Continue in the terminal" and "Copy command". `docs/GLOSSARY.md` gains the table
and a "terms that do not appear in simple mode" list; the `textos` scan (which already sweeps the main screens for
forbidden words) learns the simple screens and the new list.

### Shape of the app in simple mode

Four places, one narrow sidebar:

- **Home**: the templates as cards, the person's recent tasks below, and a "waiting for your answer" strip on top when
  any task needs them.
- **Task**: one screen per task (see below).
- **Files**: every file the person's tasks produced, newest first, with Open and Show in folder.
- **Settings**: language, theme, the folders tasks may use (the host's allowed folders, in plain words), notifications,
  and the switch. Nothing else.

Hidden in simple mode: Board, Workflows, Conversations, Teams, Personas, Snippets, Plugins, Vault, Connections, History,
Costs, the palette's technical commands, split view and the tab strip (one task open at a time, with back).

### Templates

- A **template** is: a title, a one-line description, an icon, one to three **fields** (a folder, a file, a short text, a
  choice), a prompt with placeholders for the fields, a **permission preset** and an optional **plan-first** flag.
- **Built-in templates** ship with the daemon, six to start: summarise a folder; draft a report from these files; find
  and list the action items in these notes; rename and sort these files; check these documents for mistakes; answer a
  question using these files. Each is written for people, not for prompts, and is translated (en, pt-BR).
- **Host templates**: Markdown files with frontmatter in the host's templates folder, loaded like personas, so an
  administrator can add "monthly sales report" without code. A broken file is reported on the host's doctor, not
  silently skipped.
- **Permission presets** map to the existing modes and never to `bypassPermissions` or `auto`: `read only` (= `plan`
  then ask), `ask before changes` (= `default`), `edit this folder` (= `acceptEdits`, only inside the chosen folder, and
  only when the template says so). A host template cannot ask for more than `edit this folder`.
- **Starting a task** creates an ordinary session with the preset's mode, the folder as working folder and an **output
  folder** (`<folder>/Flightdeck results` unless the template says otherwise). A folder outside the host's allowed
  folders is refused with a plain message and the host's "add folder" request, never started.
- **Plan-first**: the task starts in `plan`; the person sees the plan as a short list of steps and answers "Go ahead" or
  "Change it". One answer covers many steps (the pattern ChatGPT agent mode and Devin share).

### Questions (approvals) as yes/no with consequences

- The approval card is replaced, in simple mode, by a **question card**: one sentence of what Claude wants to do, one
  line of **consequence**, two buttons: "Yes, go ahead" and "No, don't". Esc means no.
- The sentence and the consequence come from a pure function over the request (tool, input, risk): "Create the file
  *Q3 report.docx* in *Reports*" / "This adds a new file. Nothing existing changes."; "Replace the contents of *budget.xlsx*"
  / "This cannot be undone." Unknown or complex requests fall back to "Run a step on this computer" with the risk
  wording, never with the raw command.
- **High risk keeps the hold-to-approve** (2 seconds), with the same plain wording.
- Not offered in simple mode: "allow for this session", rules, "always allow". Each question stands alone.
- **Refused, not shown**: vault and prod requests. The task pauses with "This needs someone with full access" and a
  button that opens the task in full mode on that host (hidden when the host is locked) or copies a message for the
  administrator.
- Claude's own questions (`AskUserQuestion`) show as a card with its options as buttons and a free-text box, in the same
  words.
- The tray and notifications use the same sentence: "Waiting for your answer: Create the file…".

### The task screen: progress and results, not a transcript

- **Header**: the task title (from the template and field, editable), a status chip (working, waiting for your answer,
  done, stopped) and **Stop**.
- **Activity line**: one live sentence derived from the tool events ("Reading 12 files in *Notes*", "Writing the
  report"). A pure function over the last events; never a tool name.
- **Question card** when something is pending (above).
- **Result**: when the task ends, a short **summary** (Claude's final message, rendered as Markdown, without code
  blocks unless the person asks) and the **files list**.
- **Files list**: the files the task created or changed, found by comparing the output and working folders before and
  after (a snapshot of names, sizes and times; no git needed, so it works in any folder). Each row: icon, name, size,
  "New" or "Changed", **Open** (the system's default app, through the platform layer) and **Show in folder**. Text,
  Markdown and CSV open in an inline preview first.
- **Ask for changes**: one box under the result ("Make the summary shorter") that sends a message to the same session.
  The conversation is not shown; the new reply updates the summary and the files list.
- **Show details**: a link, not a tab, opens the full session in full mode (hidden when locked). It is the escape hatch
  for the day the simple view is not enough, and where the transcript lives.
- **Failure**: a plain sentence ("Claude could not finish. You can try again or change the request.") with **Try again**
  and Show details; never a stack trace or exit code.

### Protocol and daemon

Mostly reuse. New: the host's `ui` setting (get, set), `template.list` and `template.start`, and a `task.results`
request that returns the files list for a session. Everything else is the existing session, permission and message
traffic. The daemon never learns that a client is in simple mode, except through the template's preset when a task is
started from a template.

## Tests and criteria

Areas in TDD order. Pure logic and the daemon first, the dictionary next, screens last.

| Area | What must pass |
| --- | --- |
| `simple-mode-resolve` | the effective mode is the person's choice, else the host default, else `full`; per host; a locked host ignores the person's `simple`→`full` choice and offers no switch; unknown values fall back to `full` |
| `simple-mode-host` | the daemon returns `ui.mode` and `ui.locked` in the host info (default `full`, unlocked); the set action validates, persists in the config and refuses without the host-settings trust; the setting survives a restart |
| `simple-vocabulary` | the `simple` dictionary exists in both languages with the same keys; every rename of the table resolves; `textos` finds none of the hidden terms in the simple screens, and finds one when a test string plants it |
| `templates-schema` | the template schema validates fields (folder, file, text, choice, max three), rejects a preset above `edit this folder`, rejects a prompt with an unknown placeholder, and the six built-ins parse in both languages |
| `templates-host-files` | a Markdown template in the host folder is listed with the built-ins; a broken file is reported by the doctor and does not hide the others; a template cannot override a built-in id |
| `templates-start` | starting a template fills the placeholders, picks the mode from the preset (never `bypassPermissions` or `auto`), sets the output folder and refuses a folder outside the allowed ones with the "add folder" request; plan-first starts in `plan` |
| `question-wording` | the sentence and consequence for write, replace, delete, move, run and unknown requests, in both languages, never containing a tool name or a raw command; the reversible flag is false for replace and delete |
| `question-policy` | vault and prod requests are refused in simple mode with the "needs full access" outcome; high risk requires the hold; no "allow for the session" action is produced; Esc and "No" deny |
| `task-activity` | the activity line for read, search, write, run and idle events, with counts, never a tool name; a burst of events yields the latest line only |
| `task-results` | the snapshot diff lists new and changed files, ignores unchanged ones and hidden folders, caps the list, works outside git, and never lists files outside the working and output folders |
| `home-simple-ui` | Home shows the templates, the recent tasks and the "waiting for your answer" strip; an empty host shows a first-task prompt; axe clean in both themes and languages |
| `task-simple-ui` | the task screen shows header, activity line, summary and files list per state (working, waiting, done, stopped, failed), has no transcript and no terminal control, and "Show details" is absent on a locked host |
| `question-card-ui` | the question card shows sentence, consequence and two buttons; A and N (as today) and Esc work; the high-risk hold works; a refused request shows the "needs full access" card |
| `results-files-ui` | the files list shows New or Changed, Open and Show in folder call the platform layer, and the inline preview opens text, Markdown and CSV |
| `mode-switch-ui` | the switch in both settings changes the mode at once, asks the one-line confirmation, is absent on a locked host, and the choice survives a restart; the window and tray follow the host's mode |
| `settings-simple-ui` | simple settings show only language, theme, folders, notifications and the switch; the folders list reads in plain words and offers "Add folder" |
| `smoke:simple` | a fake host set to simple, a built-in template started on a temporary folder, one question answered "yes", a file created, the task done and `task.results` returning that file; prints `SMOKE SIMPLE OK` |

**Acceptance criteria:** the usual ones (the version stays as it is on `main`), the ratchets green, axe clean in both
themes and both languages for every simple screen, the prints of Home, a working task, a waiting task and a done task
in `demo:shots`, the journeys in `e2e` for "start a template, answer yes, open the result" and "switch to full and back",
both manuals with a simple-mode chapter (en, pt-BR), and `docs/GLOSSARY.md` with the vocabulary table. Specific to this
phase: with the mode on simple, a scan of every simple screen finds none of the hidden terms, and nothing in simple mode
widens what the host's allowed folders, budgets and vault rules already permit.

## Open questions for the maintainer

1. **Per-user store.** The theme lives in the app's store; should the mode live there too (per device), or on the host
   (follows the person across devices)? The spec assumes the app store, per host.
2. **Who may set the host default and the lock.** Same trust as other host settings (a paired app with the host token),
   or only from the host's own machine? Spec assumes the former, since a business admin works from the app.
3. **Built-in templates.** The six are a guess. Which two or three matter most to the first team?
4. **pt-BR first?** The first users are likely Portuguese speakers. The spec writes both languages for every string, as
   always; the order of writing could be pt-BR first.
5. **Cowork research.** The research is secondary (see the handoff file). Worth one session reading Anthropic's own help
   pages before the `question-wording` area, since that is where tone matters most.
