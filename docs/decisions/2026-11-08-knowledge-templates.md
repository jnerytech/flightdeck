# Library documents from a template (issue #1039)

Slice 1 of #1039, a follow-up of #76: the knowledge panel starts a PRD, RFC or ADR from a built-in
template. Slice 2 (a draft ADR from a session) comes after.

## Decision

- **Command.** `knowledge.create { path, kind: adr | rfc | prd, title }` answers the new
  `KnowledgeEntry`. It is announced as `knowledgeCreate` and works inside the host's allowed roots
  like the other `knowledge.*` commands.
- **Where.** `docs/adr`, `docs/rfc`, `docs/prd` of the project. An ADR or RFC takes the next
  number after the highest `NNNN-*.md` (four digits or more) in its folder; a PRD is named by its
  title. The name is the title in lowercase ASCII (accents folded, other characters dropped, 60
  characters at most); a title with no letter or digit is refused (`knowledge_title_invalid`).
- **Draft status.** The template starts with `status: transitional`, so a new draft is not given to
  agents as a valid document until the person marks it valid (a status picker is on the panel). A
  separate "draft" status would need a protocol change for little gain.
- **The title is text, not data.** It goes only into the `# heading` and the file name, on one line
  (controls, line breaks and direction marks become a space), never into the front matter: a title
  that looks like YAML stays a line of text.
- **Safe write.** The file is created with `wx`, so it never replaces a file and a link left at the
  name is not followed (`knowledge_exists`). `docs` and `docs/<kind>` must be real folders (made
  when missing, one level at a time) and `docs/<kind>` must resolve to where its name says inside
  the project's real path; otherwise nothing is written (`knowledge_folder_unsafe`). A numbered
  name taken between the listing and the write is tried again with the next number, three times.
  The file is left uncommitted, mode 0644.
- **Not decided here.** The template text is English; a project that wants its own template edits
  the file after it is made.
