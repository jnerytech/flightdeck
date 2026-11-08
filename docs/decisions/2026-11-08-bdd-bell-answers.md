# Answering from the bell is a Gherkin feature (issue #1131)

- **Done.** `scripts/e2e/bdd/features/bell-answers.feature`, en and pt-BR: a session waits for a command, its request is put in the bell by hand (the web demo sends no notification), and at a phone's width the row shows its risk and the buttons Approve and Deny, fits inside the panel, and Approve takes the row out with the status "<session>: approved". A second scenario denies with the N key on the row's title. It replaces the plain journey `bell-approve`; its 390 px fit measure is a step of the first scenario.
- **Proof.** Once locally per language (22 to 40 s); red when the answering steps are cut. The 90 s limit is the PR's e2e job.
- **Not done.** The high-risk request (a button held for 2 s, never a key) has no scenario: the demo's request is medium risk, and a held press is a pointer timing the unit tests of the button already hold.
