# Risk-graded approval

[Back to the manual](../en.md) · [Português (Brasil)](../pt-BR/risk-graded-approval.md)

Every permission request carries a **risk seal**, set by a fixed rule list in the daemon (no AI):
**Low risk** (reads inside the project), **Medium risk** (most commands, writes inside the project,
anything that reaches the network, unknown tools and MCP) and **High risk** (for example `rm -rf`,
`git push --force`, `sudo`, command substitution, a pipe into a shell, or any access to credential
paths). You can add patterns in the host configuration (`risk.extraHigh`); the built-in ones cannot
be lowered.

- A **High risk** request is red and **Approve** becomes **Hold to approve**: hold the button for 2
  seconds. The reason is written under the button (not only in a tooltip). The A key does not
  approve it; N still denies. The host checks the hold too: it refuses
  an approval of a high-risk request that does not carry it ("A high-risk request is approved only
  by holding the button."), so no other client can skip it either.
- The tray never approves a high-risk request: it offers **Deny** and **Open**.
- With automatic approval on, an approval that nobody gave by hand shows in the session's
  timeline as "Approved automatically", with who decided and why. A high-risk request or one that
  reaches the network always comes to you.
- On a host whose daemon has automatic approval, the host page has an **Automatic approvals**
  button. The screen lists what the daemon decided, newest first: the tool, the risk, whether it
  **Approved** or **Asked you**, who decided (the rule or the AI and its model) and why. Filter by
  project, or by tool or reason in **Filter decisions**. **Suspended sessions** lists the sessions
  where automatic approval stopped because third-party content arrived, with the reason; **Resume**
  asks for confirmation before turning it back on.
- The tray tooltip adds how many automatic approvals the app has seen.

## Approving devices

A host can also ask for the **signed proof of one of your devices** before a high-risk request is
approved, and before any approval that saves a rule ("always allow"). It is off until you enroll a device:
until then the hold of the Approve button is the only check, as before.

- **Enroll.** Open the host's page and find **Approving devices**. On the host's terminal run
  `flightdeckd approvers enroll`, then type the **name** of this device and the **one-time code** it
  prints, and press **Enroll**. The code works once, for ten minutes. The app makes a key that never
  leaves this device and gives the host only its public half.
- **Approve.** With the host's protection on, **Hold to approve** (and the approval of a saved rule) asks
  you once more in a window of the system, naming the request and saying when the approval also saves a rule. Cancel it and nothing is sent;
  the request stays open. The window is the system's, not the app's, so a page shown inside a session
  cannot press it.
- **See and revoke.** The panel lists every enrolled device with its name, the app and address it enrolled
  from, and the date. **This device** marks the one that holds the key you are using. **Revoke** removes
  another device (or this one, but never the last: only `flightdeckd approvers reset` at the host does).
  **Remove this device's key** drops the key kept here; the host keeps listing the device until another
  one revokes it.
- **A warning.** If protection was on and the host now lists no device, the panel says so. If you did not
  reset it at the host, someone with access to it did.
- **What it does not cover.** It guards approvals made from the app. Anyone with a terminal on the host
  can still reset it, and a request in the medium tier needs no proof. A second device is added with a key
  that is already enrolled; the app cannot do that yet, so for now reset at the host and enroll again.
