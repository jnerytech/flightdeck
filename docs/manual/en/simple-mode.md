# Simple mode

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/simple-mode.md)

Simple mode is a calmer face of the same app, for people who do not use a terminal. It changes only
how a host looks, not what it can do: the sessions, the permissions and the files are the same.

**What you see.** A narrow menu with three places: *Home*, *Files* and *Settings*.

- *Home* asks "What do you want done?". Under it, two lines say what a task is (Claude working on
  your files on this computer) and which computer the tasks run on, with its connection. If that
  computer is not connected, does not accept the app or needs an update, a notice says what to do
  and *Start this task* stays held; if no
  folder is allowed yet, a note with a button opens *Settings* to add one. Ready-made tasks are
  cards (summarise a folder, draft a report, review a document, compare files); each card lists its questions and
  whether it only reads your files, asks before it changes anything or edits the folder you pick, and starts the task once you answer.
  Tasks that wait for you come first, then your recent tasks; before your first one, three steps
  show how a task goes: pick a card, answer its questions, get what it made in the *Flightdeck results*
  folder, inside the folder you picked.
- A *task* shows what it is doing in a line, asks its questions in plain words with **Yes, go ahead** and
  **No, don't** (and says when something cannot be undone), and when it is done shows a summary and the
  files it made. Open a file, show it in its folder, or ask for changes. *Show details* opens the
  full view of the session.
- *Files* lists what your recent tasks made, newest first.
- *Settings* has the language, the theme, the folders tasks may use, notifications and *Show
  everything*, which goes back to the full app after a confirmation.

**Outside the window.** Notifications, the tray and the window title follow the mode of the host that
raised them (the window title follows the host you are looking at). For a host in simple mode a notification is titled "<host · task>: waiting for your
answer" and says what the task wants in plain words, instead of "needs you / Allow Write?". When
that host is in simple mode, the window title becomes "Flightdeck: 2 tasks waiting for your answer";
the tray tooltip says the same when every waiting host is in simple mode. Hosts in full mode keep the technical wording.

**Safety.** A task never skips questions: it can only read, ask before it changes things, or edit
the chosen folder. Results go to a *Flightdeck results* folder next to your files. Simple mode hides
things, it does not protect them: a person in full mode can do everything the host allows.

**Switching.** In full mode, open a host's page and use the *Simple mode* panel. Its first lines say
which mode the host opens in and whether it is locked. *Default mode* (*Full app* or *Simple mode*)
sets what the next person sees; *Use simple mode on this host* is your own choice, kept in this app.
The *Lock this host to its mode* switch removes the choice for everyone (it asks first); a locked
host stays in its mode. Each change shows a message, and the host's row in the sidebar carries a
*Simple* badge when it opens in simple mode and a lock when it is locked.

**Getting out of simple mode.** Every simple screen ends its menu with *Full app* (it asks once).
On a locked host the menu says to ask its admin to unlock it instead. **Ctrl+Shift+M**, the palette
(*Switch to the full app*) and, in the full app, *Simple mode* in the sidebar's footer switch the
mode too, keeping your tabs.

**Your own templates.** A host can add tasks as Markdown files in `templates/` inside the daemon's
data folder: a header with the title, icon, fields, preset and whether to plan first, then one
prompt section per language (`# en`, `# pt-BR`). A file with a problem is skipped and the host's
health check (*doctor*) lists it.
