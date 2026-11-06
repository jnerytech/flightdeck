# Approval safety, second pass (issue #245)

- **The hold is checked in the store, not in the daemon.** `respondTo` and `respond` refuse an allow
  of a high-risk request unless the answer says it was held (`Answer.held`), and the person sees "A
  high-risk request is approved only by holding the button." The proof comes from the hold itself:
  `HoldButton` → `ApprovalActions.onApprove(true)`, and the simple mode's yes the same way. A screen
  that forgets the risk now fails safe ("Approve does nothing, and says why") instead of approving
  in one click. **Not done:** the daemon still accepts `permission.respond` allow for a high-risk
  request without proof. That needs a protocol field and a daemon check; it is left for a decision.
- **One hold constant**, `HIGH_RISK_HOLD_MS` in `lib/hold.ts`: the buttons, the simple mode and the
  `heldMs` the store reports to the vault.
- **`risk` is a required prop of `ApprovalActions`**, typed `RiskLevel | undefined`, so each caller
  says it. A request with no risk keeps one click: external sessions' requests carry no risk at all
  (`central/external-permissions.ts`), so treating a missing risk as high would hold every one of
  them.
- **A gate in Needs you** shows its question and its output (`GateText`, shared with the run's
  timeline). A gate is never held: it has no risk.
- **A tile** shows what a request would do (`inputSummary`) and, when high, why. A question or a
  plan offers only "Open to answer": a tile shows neither the questions nor the plan. Both buttons
  stay off while an answer is on its way.
- **A high-risk plan is held**, like any request. Only a question, which approves no action, is
  answered by a click. The daemon gives `AskUserQuestion` and `ExitPlanMode` medium risk today, so
  this guards the day a rule raises them.
- **The tray offers Deny** for a high-risk or vault request (Deny never needs a hold); Approve still
  takes the window. A gate still only opens.
- **The palette's approve and deny carry the request they named** (`host/request`). If that one was
  answered in between, the one now oldest is opened, never answered unseen.
