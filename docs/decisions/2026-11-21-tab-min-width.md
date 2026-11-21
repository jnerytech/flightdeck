# A tab keeps at least 9 rem (issue #3794)

A divergence from [the responsive layout decision](2026-11-06-responsive-layout.md), which keeps each tab between 6 rem and 13 rem.

With ten tabs of one screen open, a tab at 6 rem left the title one or two letters once the icon, the badge and the close slot took their share, so every tab read "O...". The floor is now 9 rem; the ceiling stays 13 rem.

- Fewer tabs fit before the strip scrolls sideways. The strip already scrolls, shows the selected tab and, past 8 tabs, offers the list of all tabs, so no tab becomes unreachable.
- A pinned tab is still only its icon.
- The e2e `layout` journey measures the floor at 1024x700 with 12 tabs and with 2 (143 px, a pixel of rounding).
