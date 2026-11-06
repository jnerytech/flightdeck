# Hold button hint as visible text (issue #238)

- **The reason to hold is text under the button,** linked with `aria-describedby`, not a native
  `title`. A `title` never shows on touch or keyboard and is read inconsistently. It covers both
  users of `HoldButton`: the approval card and the simple-mode question card. A button without a
  hint renders exactly as before.
