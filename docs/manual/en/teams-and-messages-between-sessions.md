# Teams and messages between sessions

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/teams-and-messages-between-sessions.md)

Claude Code sessions can message each other through Flightdeck, on the same host or across hosts.

- **The tools** come from the MCP (`flightdeckd mcp`) or the `flightdeck` mod:
  - `list_sessions`: the sessions this one may see, with their address (`host/id` or the alias);
  - `send_to_session`: the answer is delivered, queued or refused with the reason;
  - `notify_when_idle`: one notice when the other session ends its turn;
  - `read_session`: read only;
  - `team_status`: the state of a team.
- **Who is sending** comes from the session's environment: `FLIGHTDECK_SESSION` in managed
  sessions, `FLIGHTDECK_LAUNCH_ID` in those opened by `flightdeckd claude`.
- **Delivery on one host** needs no app:
  - a managed session in the middle of a turn gets the message when the turn ends;
  - a terminal waiting for a permission gets it after that.
- **Delivery across hosts** goes through the app, which carries the message from one daemon to the
  other. With the app closed, the message waits up to 24 hours. A plain `claude` (no channel)
  receives nothing.
- **Known limit:** only session messages cross hosts. STOP, resume and the idle notice work on the
  team's host, and `read_session` and `notify_when_idle` only see sessions of the same host.
- **In the app:**
  - **Conversations** (sidebar) lists the messages newest first, with filters by state and team;
  - each session has a **Messages** tab with what it sent and received;
  - from that tab, **Send to another session…** sends a message from the session to another one.

## Standard session names

- **Every session gets a name** when it appears: `project · persona · number`, for example
  `flightdeck · revisor · 3`.
  - Without a persona, the persona is `geral`.
  - A card's session takes the card's number: `flightdeck · autor · card 42`.
  - The app shows the name in its language, with the persona's name: `flightdeck · Code reviewer · 3`,
    and `general` for a session without a persona. The alias stays as it is.
- **Every session also gets an alias:** `project-persona-number`, for example
  `flightdeck-revisor-3`. The alias addresses the session, alone or as `host/alias` across hosts.
- **A number is never reused**, not even after the session is gone.
- **Renaming a session** changes its name and adds an alias. The old alias keeps working.
- **In Sessions:**
  - a host that has names shows them;
  - inside each project, sessions are sorted by name, after the ones that need you and the pinned
    ones;
  - **Filters → Persona** keeps one persona;
  - a name you gave a session still wins.

## Who may message whom

- **The default:** only sessions of the same project or of the same team talk.
- **Settings → Messages between sessions on <host>:**
  - adds exceptions by session, project, team or host, one way or both ways (**Both ways**);
  - sets the **retention** of the history (30 days by default);
  - lists the **pairs paused for a loop**, with **Free**.
  - If the host refuses a change, the section says why.
- **Limits:**
  - 20 messages per hour per pair, and 100 per hour per session;
  - 32 KB per message.
- **A loop pauses the pair:** more than 10 messages back and forth in 10 minutes.
  - You get a notification, and the pair waits in **Needs you**.
  - **Free the pair** lets the pair talk again.
- **A message is never an approval:**
  - its header says it comes from another session, not from you;
  - no message answers a permission request.
- **Third-party content:** a session that received third-party content passes that mark on, and
  automatic approval stays off for whoever it messages.

## Teams

- **A team** is a coordinator session and its workers. Each worker runs in a card, with its own
  worktree.
- **Teams** (sidebar) creates a team: the project, the goal, a name and, if you want, the
  coordinator's persona and model. The workers are rows: each has its own persona and model, and
  you add or remove rows (the number of rows is the number of workers, 1 to 8). A worker's
  persona starts as the Developer when the host has it; pick **None** for the plain default. With no choice,
  the model is the persona's. Each member's model shows on its line.
- **Each member's permissions** are picked in the same row (and for the coordinator): **Default**
  (asks before changes, or the persona's own mode when it is stricter), **Accept edits**, **Plan**
  and, only where the host allows it, **Ignore permissions** (Bypass). Choosing Bypass asks for a
  confirmation before the team is created or the worker is added; a host that forbids it refuses
  the team before any member starts. The rows line up in columns: persona, model, permissions,
  remove. A host that is too old to take the modes shows no permissions picker, so a choice is
  never silently ignored.
- **Each member's name** says who it is: the team and the persona in the app's language, such as
  "md-server · Architect 2" or "md-server · Coordinator"; with no persona, "Worker 2". The name
  shows in the sessions list, the search and Needs you. A name you gave, or the one Claude Code
  gave, still wins, and the address for messages does not change.
- **The coordinator's cycle:**
  1. split the goal into tasks, each with what "done" means;
  2. send one task to each worker, and ask to hear when it goes idle;
  3. check the work itself, with the project's checks or the team's commands, in the worker's
     worktree;
  4. accept only a green commit;
  5. integrate in the agreed order;
  6. tell you when something is your decision;
  7. report the team's outcome.
- **The team's outcome:** the coordinator reports it with the `team_report` tool (up to 4000
  characters); the host refuses any other session. Its last report heads the team's card under
  **Outcome**, marked **Done** or **In progress**, as plain text; a long one scrolls in a box the
  keyboard can reach. Below it, each worker's row shows its **Last report**, its card's branch and
  how many files the card changed. When the coordinator reports the goal done, a notification says
  so and opens the team.
- **Changing the team from the coordinator:** the coordinator can add a worker in a persona it
  picks with the `team_add_member` tool (a persona, an optional model and a brief of up to 4000
  characters, which goes in the new worker's card after the standard instructions), and take one out
  with `team_remove_member` when it is no longer needed: its turn stops, and its card and branch
  stay. The new worker always opens in the default permission mode. The host refuses any other
  session, an unknown persona, a paused team, a team that already has 8 workers and a plan quota
  that is over its limit (it does not queue). You see the change in the team's row at once.
- **From the team's row you can:**
  - pause it (STOP to every member) and resume it;
  - send a message to everyone;
  - change a member's persona;
  - add a worker, choosing its persona, model and permissions (the coordinator is told its name and
    card);
  - take a member out: its session is stopped, the coordinator is told, and its card stays on the
    board;
  - close the team, with a confirmation.
- **Deleting a closed team:** a closed team keeps its card until you delete it. Its card's **⋯**
  menu has **Delete team**: off on an open team (it says "Close the team first"), and on a closed
  one it asks first, naming the team. What goes is the team record and its card on the Teams page.
  What stays is every member's session, with its transcript and history, and their board cards:
  they are only taken out of the team. The host refuses while a member is at work (running, or
  waiting for an answer); try again once they rest. Every connected app drops the card.
- **The quota:** when the plan quota crosses the limit (`quota.pauseAt`), the team pauses by
  itself. You get a notification, and the row says "paused by the quota". When the window
  restarts, the team resumes and tells you.
