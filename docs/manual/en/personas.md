# Personas

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/personas.md)

A **persona** is an engineering role Claude takes in a session: a name, a description, an icon, a
suggested model, effort, tools and permission mode, and the instructions of the role. The
**Personas** screen (sidebar, for hosts that keep them) lists them by where they live:

- **Pack**: thirteen come ready, in English and Portuguese (architect, security reviewer, QA, SRE,
  performance, code reviewer, docs, **frontend** (builds the screens, leaving the UX judgment to UX), **UX** (judges whether a person can finish a task and
  only recommends: it has no edit tool), **UI** (keeps the interface consistent with the design
  system and fixes it in small PRs), DBA, the team coordinator of phase 21 and the
  **Developer**, the one that writes the code: test first, small scoped changes, follows the
  project's CLAUDE.md and ADRs, runs the project's checks before saying done, never pushes). Editing one
  keeps your version on the host (**Pack, edited**); **Restore original** brings the pack's back.
- **Host**, **Project** (choose one: its own and the versioned `.flightdeck/personas/*.md`, which
  you **Trust** first) and **Global (this app)**, kept in the app.
- **New persona** and **Edit** open the editor with a **Preview** of what the session gets. **Edit**
  opens the form inside the persona's own card, with the first field focused and the card scrolled
  into view; **New persona** opens it at the top. **Cancel** and **Save** put the scroll back and
  the focus on the Edit button. **Model** is a choice (**Other…** for free text) and **Tools** a
  multi-select. A persona never holds a secret: one is refused with the reason.
- **Publish as agent** writes the persona to `.claude/agents/persona-<id>.md` through the
  agent editor, with confirmation, so it also works for plain `claude`.

Using one:

- **+ New session**, **Ctrl+K** (**New session as <persona>**), **Card persona** next to **Start**
  (it suggests the Developer when the host has it; pick **None** to start without one),
  and each variant of **Start in arena** have a **Persona** field. The session opens in it: the
  instructions go after the system prompt, with the model, effort and tools it suggests. A persona
  only takes away: its tools are a subset of the session's, and its permission mode counts only
  when it is less permissive.
- **Claude here** has its own picker and runs `flightdeckd claude --persona <id>` (the host's, the
  project's and the pack's; the app's own have no id on the host).
- On an open session (managed, or a terminal session you can control), **Apply persona** sends the
  role as a message, and **Back to normal** ends it. The app says so: in an open session the persona
  is an instruction of the conversation, not of the system. After each press it also says how the
  instruction went: **sent** to an idle session, **queued** behind the current step or a pending
  permission request (it is sent once that is answered), or **sent to the terminal session** (it
  shows in the conversation when Claude takes it, after any pending request). **Claude here** with
  a persona is different: it starts a new terminal session with the persona in the system prompt.
- **Personas as subagents** on the project's agent screen: **All** (the pack's, the host's and the
  project's), **Only the project's** or **None**. They reach the sessions as `persona-<id>` agents,
  for Claude to delegate to.
- The project form has a **Default persona** per board column: a card that starts from that column
  opens in it, unless you chose another.
- The session list shows each session's persona and filters by it; **Costs** has **By persona**.
