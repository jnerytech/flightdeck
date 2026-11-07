# Under 640 px the tab row is one button for the current tab (issue #644)

A strip of tabs to scroll sideways is a poor fit for a phone-width window: tabs are cut, the strip
overflows and a thumb has to find the one it wants.

- At the compact width (`useBreakpoint() === "compact"`, under 640 px) `TabBar` draws one button
  instead of the strip: the current tab's icon, its host's dot and its title, the number of tabs and a
  chevron. It is the trigger of the list of all tabs (`TabOverflow`), which at this width takes the
  window's width less 1 rem instead of a 24 rem card.
- Its accessible name begins with the list's: "All tabs (N), current: {title}", with the host in the
  title of a host's tab. That keeps the visible text inside the name, and keeps the scripts that look
  for the "All tabs" button working with a prefix match.
- The tablist is not drawn at this width, so its keyboard handling (arrows between tabs, move and
  close keys) is not either; the list's own keyboard (arrows, Enter, Delete) and the window's shortcuts
  (Ctrl+Tab, Ctrl+W) are what is left. The split is not offered: two areas under 640 px leave neither
  one a screen. A window already split keeps its areas, each with its own button.
- **+** stays beside the button. The overflow baseline for the strip at 390 px goes: the strip is gone
  there.
- Still to come in #644: the All hosts row.
