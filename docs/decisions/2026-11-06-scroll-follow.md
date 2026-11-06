# A conversation that follows its end is not told to stop by the browser (issue #315)

- **The failure.** The e2e journey `rolagem-fim` failed on main, in `en` and then in `pt-BR`, with
  "the conversation opened at the end": the view ended a few lines above the last message, with
  the "Jump to latest" button on. It passed on this Pi every time and failed about one run in three
  on CI.
- **What the trace shows.** The conversation is replayed into the page while its status still
  reads "running". When the last turn ends, two things happen in one frame: the "working" rows go
  (the content shrinks, and the browser pulls `scrollTop` back, with a scroll event), and the
  summary card appears above the conversation (the scroller gets 150 px shorter). The event for the
  first one is delivered after the second: `SessionView` read the distance to the end then, found
  150 px, took it for the person leaving, and stopped following. Nothing pinned the end again.
- **The fix.** While the view follows the end, a scroll event that is not at the end is the
  person's only when a hand was on it: the wheel, a key, a touch or a press on the scrollbar
  (`onWheel`, `onKeyDown`, `onTouchStart`, `onTouchMove`, `onPointerDown`), within 600 ms. Any
  other scroll while following is ignored, and the resize observer pins the end as before. A scroll
  that reaches the end still turns following on, and a view that is already away is judged as it
  was. The distance is still measured when the event arrives; what changed is who may turn the
  following off.
- **Tests.** `sessao-rolagem-fim` replays the order (clamp, panel, event) and expects the button
  not to show and the next layout change to pin the end; the wheel, a key, a touch and a press each
  still leave the end. The other scroll tests say "the person scrolls" with a wheel before the
  scroll event.
- **Not confirmed.** The failure never showed on this Pi, so the cause rests on the trace of the
  failed runs and on the test that replays it; the e2e journey runs only on main, so the next main
  runs show whether it is gone. If it comes back, the trace of that run is the first thing to read.
- **Known limit.** A person who scrolls up with something the view does not hear (a screen reader's
  scroll command, a script) is ignored while the view follows the end: it can scroll again with the
  wheel, a key or a touch. The window is 600 ms, so a slow drag of the scrollbar longer than that
  after its first scroll event is judged event by event, as before.
