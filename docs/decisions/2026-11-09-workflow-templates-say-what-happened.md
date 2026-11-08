# The templates dialog says what happened (issue #1092)

"Add from a template" had three silences. A failed copy (the clipboard refused) changed nothing, so
the person believed the file was copied; a second copy was not announced again, because the
"Copied" status was mounted together with its text; and a host with no templates showed an empty
list with no words.

## Decision

- A refused copy is an alert: "The clipboard refused the copy. Select the file's text above and copy
  it by hand."
- "Copied" lives in a status region that stays in the page. A new copy empties it first and fills it
  when the copy works, so every copy is read out.
- No templates: "This host offers no templates." instead of an empty list.
- Two strings in both languages (`copyFailed` and `none`; the copied text is the existing one).
