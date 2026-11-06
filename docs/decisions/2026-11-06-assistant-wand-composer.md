# The wand on the message box: first slice of the wand UI (issue #158)

- **A hook and two parts, not `AssistField` yet.** The spec wraps a field in `AssistField`. The message box is owned by
  `SessionView` (its text, its ref and its key handler), so the first slice gives `SessionView` an optional `assist`
  binding (`controller`, `kind`, `fieldHostId`, `cwd`, `openSettings`) and calls `useWand(binding, text, setText)`. The hook
  holds the reducer of `wand-state.ts` and the run; `WandButton` (toolbar) and `WandPanel` (above the box) draw it. The
  next slices reuse the same hook for `AssistField` and the other fields.
- **Slice 1 covers** the button (improve, write, "Write something first", "Another AI request is running"), Ctrl or Cmd+I
  in the box (IME composition ignored, the key prevented), running with Cancel and Esc, and the preview (Before and After,
  Accept, Discard, Esc). No provider opens Settings, section Assistant, with a one-line notice shown once.
- **Left for the next slices** (same issue): Edit, Retry, the word diff, the undo chip and Ctrl+Z, "Try with <provider>",
  the `assist-field` entry of the shortcut sheet, and the other surfaces of the table (#160).
- **Stale text.** When the box changed while the answer was written, the preview says so and the Accept button reads
  "Accept anyway" instead of opening a second confirmation: one click already is the person's decision on a visible
  preview.
- **The one-run gate holds until the call ends.** Cancel closes the wand at once, but the app's one run is given back when
  the cancelled call settles (the provider rejects it); until then other wands read "Another AI request is running".
- **Esc.** The hook handles Esc from the box (cancel a run, close a preview or a failure); nothing open leaves Esc to the box
  (which still interrupts a running session).
- **A short window has no toolbar button.** At 720x480 (a pane under 600 px high, `ShortArea`) the extra button narrowed
  the box, the placeholder wrapped and the conversation fell to 139 px, under the 150 px floor of the layout journey. In
  a short area the button is not drawn; Ctrl or Cmd+I still reaches the wand, and the preview and Cancel still show.
