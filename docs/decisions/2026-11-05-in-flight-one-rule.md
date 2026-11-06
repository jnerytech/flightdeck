# One in-flight feedback rule by duration (issue #240)

- **The rule** lives in `hooks/use-in-flight.ts` (`IN_FLIGHT`, `inFlightStage`, `useInFlight`,
  `useAfter`): under 100 ms nothing changes on screen; to 1 s the control only looks busy; from 1 s
  a spinner; from 3 s a stage label ("Still working…", or `stageLabel` when the caller knows the
  stage); a loading panel draws its placeholders after 200 ms. `ActionButton` and the primary of
  `FormActions` follow it (`data-feedback` says the stage), and so does `LoadingState`.
- **Busy from the first millisecond.** Only what is drawn waits: `aria-busy`, `disabled` and the
  guard against a second click start at once, so a double click can never run the work twice.
- **Minimum time.** `useMinLoading` still holds the placeholders for 150 ms, but counts from when
  they were drawn (after the 200 ms), and a load that ended before then leaves at once: it never
  drew anything, so there is nothing to hold. This changed the `estados-avisos` clock test (end
  at 250 ms, gone at 350 ms).
- **The stage label joins the accessible name** of the button ("Save Still working…"); that is
  intended, a screen reader hears that the wait is long. Tests that look the button up by exact
  name use a pattern.
- **Not covered, on purpose:** the activity line, the status line's spinner and the simple-mode
  task view. They show a running turn (a state the session is in, which lasts seconds to minutes
  by nature), not a wait on something the person just did, so a delay would only hide a true
  state. Nothing to change there.
- **`docs/DESIGN.md`** (issue #193) is not on this base; the rule for it is the first bullet and
  belongs in its feedback section when that branch lands.
