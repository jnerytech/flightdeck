# Approve or deny the oldest request from the palette (issue #187)

- **Nothing is answered unseen.** The two palette commands name the request they answer, for
  example "Approve the oldest request: alfa · Backend tests: Bash: npm test". The line is the same
  one the Needs you row and the tray show (`pendingText`). So the person reads what they approve
  before pressing Enter, or A and N.
- **Some requests open instead.** A workflow gate, a vault request and a high-risk request offer
  only "Open the oldest request: …", and the command opens it where it is answered:
  - a gate opens on its card, since a gate is not a permission and the host refuses its id;
  - a vault request opens to show the secret, and it is never logged as a tray grant;
  - a high-risk request opens to be held.
- The tray keeps its own rule: Open only, for gates and high-risk requests. The shared
  `onTrayAction` also opens a gate if one ever reaches it.
