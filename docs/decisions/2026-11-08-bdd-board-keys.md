# The board by keyboard is a Gherkin scenario (issue #1198)

- **Done.** `scripts/e2e/bdd/features/board-keys.feature`, en and pt-BR. At 1280 the person tabs from the board's filter to the first card (the board is one Tab stop), presses the right arrow until a card in Done has the focus, and Enter opens it. At 390 the board shows one column, and its column buttons switch it to Done. Red when the cards' roving Tab stop or the switcher is cut.
- **Not done.** `s` and `m` on a card, and `g s` left to the go-to chord: the component tests of `board-keys-ui` hold them, since a scenario that starts a demo card would change the board the other scenarios read.
