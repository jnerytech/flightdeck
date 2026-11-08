# The sessions list states are a Gherkin scenario (issue #1132)

- **Done.** `scripts/e2e/bdd/features/hub-states.feature`, en and pt-BR. The scenario starts a session in a folder of its own (so its project group holds only it), waiting for a command; the sessions list says "Waiting for you" and "wants to run Bash" on its row, its group counts "N of M active"; the person approves it from Needs you, and the list now says "Idle". Red when the approval is cut.
- **Not done.** Ended and Failed rows: the demo has no way to end or fail a session the scenario made, and the seeded ones are not the scenario's own state (the unit tests of `hub-row-state` hold them). The project chip at a narrow width (#1164, #1169) is layout, which stays in the plain journeys.
