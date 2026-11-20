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
approved, before any approval that saves a rule ("always allow") and before a pull request is merged from a card. It is off until you enroll a device:
until then the hold of the Approve button is the only check, as before.

- **Enroll.** Open the host's page and find **Approving devices**. On the host's terminal run
  `flightdeckd approvers enroll`, then type the **name** of this device and the **one-time code** it
  prints, and press **Enroll**. The code works once, for ten minutes. The app makes a key that never
  leaves this device and gives the host only its public half.
- **Add a second device.** With protection on, a new device is added by one that is already enrolled. On the
  new device open the host's page, type a **name** and press **Show the text**: it makes its key and shows a
  text and a **code** of four groups of four characters. Copy the text to the enrolled device, paste it in
  **Add another device** on the same host's page and press **Read**. The panel shows the name, the host and
  the code. Add the device only if the **code is the same** on both screens: the name is only a label. Press
  **Add this device** and agree in the window of the system, which names the code and the host again.
  Cancel the window and nothing changes. The new device lists itself once the host has it; **Cancel** on it
  drops its key.
- **Approve.** With the host's protection on, **Hold to approve** (and the approval of a saved rule) asks
  you once more in a window of the system, naming the request and saying when the approval also saves a rule. Cancel it and nothing is sent;
  the request stays open. The window is the system's, not the app's, so a page shown inside a session
  cannot press it.
- **See and revoke.** The panel lists every enrolled device with its name, the app and address it enrolled
  from, and the date. **This device** marks the one that holds the key you are using. **Revoke** removes
  another device (or this one, but never the last: only `flightdeckd approvers reset` at the host does).
  **Remove this device's key** drops the key kept here; the host keeps listing the device until another
  one revokes it.
- **A notice.** When a device is enrolled or revoked on a host, the app tells you. A device you did not
  enroll from here is an alert that names it: if it was not you, revoke it on the host's page. Your own
  enrollment, and a revoke you make here, are not announced. If another device revokes this device's key,
  the notice says so, and this device can no longer approve there until it is enrolled again. With the
  host's page open the notice is shown there, with **Dismiss**; otherwise it is a toast. A terminal can
  see the same changes: `flightdeckd approvers watch --follow` prints a line each time. Hosts older than
  this announcement are only read when you open the page.
- **Merging a pull request.** With a device enrolled, **Merge PR** on a card asks you once more in a window
  of the system. The window names the pull request and the short head commit you are merging, and the way
  (merge commit or squash). Cancel it and nothing is sent. If someone pushes to the pull request after the
  app read it, the host refuses the merge and says the pull request changed: look at it again. A host that
  does not yet ask for the device on a merge shows a notice on its page: update it.
- **Bypass permissions.** With a device enrolled, **Allow sessions without prompts** on the host's page asks
  you once more in a window of the system, and the window names the host. Cancel it and nothing is sent.
  **Turn off** asks nothing. On a host that checks it, a session can no longer turn Bypass back on by itself, because it has no
  device to sign. A host that does not yet ask for the device here shows a notice on its page: update it.
- **Allowed folders.** With a device enrolled, adding a folder to **Allowed folders** asks you once more in a
  window of the system. The window names the folder and says that sessions will be able to run in it and in
  everything inside it. Cancel it and nothing is sent. If the folder you typed is a link or a path that points
  elsewhere, the host refuses and tells you the folder it really is: add that one. A host that does not yet ask
  for the device here shows a notice on its page: update it.
- **Writing a project's Claude Code setup.** With a device enrolled, **Apply the setup** asks you once more in a
  window of the system. The window names the folder and the parts to write (and the template, if you picked one),
  says that hooks run as commands in every session of the project, and says when the settings file will be rewritten
  with another layout. It does not list the hook commands: read them in the preview before you apply. Cancel it and
  nothing is written. If the setup changed on the host after you previewed it, the host refuses: preview again and
  confirm again. A host that does not yet ask for the device here shows a notice on its page: update it.
- **Installing or updating a plugin.** With a device enrolled, **Install** and **Update** ask you once more in a
  window of the system. The window names the plugin (or the folder it comes from), where it will be installed, and
  says that a plugin runs code on this computer. It does not list what the plugin contains: read that in the preview
  before you confirm. Cancel it and nothing is installed. If the plugin changed after you previewed it, the host
  refuses: preview again. When the marketplace declares a command, the dialog opens a second time for the step that
  accepts it. A host that does not yet ask for the device here shows a notice on its page: update it.
- **Trusting a project.** With a device enrolled, **Trust this project** asks you once more in a window of the
  system. The window names the folder and says that its hooks and servers will then run with no prompt. Cancel it
  and nothing is sent. Revoking trust asks for nothing. A host that does not yet ask for the device when you
  trust a project shows a notice on its page: update it.
- **Turning automatic approval back on.** With a device enrolled, **Resume** on a suspended session in
  Automatic approvals asks you once more in a window of the system. The window names the session and says that
  it will approve requests again with no person seeing them. Cancel it and nothing is sent. The terminal
  command `flightdeckd autoapprove resume` is refused on such a host and tells you to do it in the app. A host
  that does not yet ask for the device shows a notice on its page: update it.
- **A warning.** If protection was on and the host now lists no device, the panel says so. If you did not
  reset it at the host, someone with access to it did.
- **What it does not cover.** It guards approvals made from the app. Anyone with a terminal on the host
  can still reset it, and a request in the medium tier needs no proof. A device you cannot sign
  from (for example, the only one enrolled was lost) is added again only by resetting at the host and enrolling
  again.
