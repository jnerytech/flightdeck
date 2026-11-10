# A conversation opens on its latest message (issue #112)

- **The end follows the layout, not only the messages.** Images, code blocks and the summary panel change the height after
  the first paint, which fires no scroll event, so "scroll to the bottom when a message arrives" left the view short of the end.
  A `ResizeObserver` on the scroller and its children re-pins the bottom while the reader is at the end (within 24 px); once
  the reader scrolls up, nothing moves them. The same holds in the transcript reader.
- **Jump to latest counts the new ones.** The view remembers the last message seen when the reader left the end, and the button
  says how many came after it. Older messages loaded above never count.
- **Position per tab.** SessionView takes a `scrollKey` (host/session, or card/step); the position, whether the reader was at
  the end, and the last seen message are kept in memory (200 conversations, oldest dropped) and restored when the view comes
  back. A reader who was at the end comes back to the end; nothing is saved across app restarts.
- **Older pages do not move the view.** When messages are prepended while the reader is not at the end, the scroll offset grows by
  the added height, so the same message stays under the eyes.
- **The history reader opens on the latest page.** `history.get` takes `tail`: without a cursor it answers the last `limit`
  readable messages, and every page now says its own `cursor`, so live appends read on from the right place. An older daemon
  ignores `tail` and sends the first page; the reader then opens on the end of that page, which is the old behaviour at worst.
  A search hit or a cursor still opens at its point.
