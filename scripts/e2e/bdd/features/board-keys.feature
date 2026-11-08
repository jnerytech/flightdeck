@board-keys
Feature: The board by keyboard and at a phone's width
  A person reaches any card of the board in a few keys, and a narrow board shows one column at a time.

  Scenario: From the board's first card to Done by keyboard, then open it
    Given I open the board of the demo project
    When I press Tab from the board's filter until a card has the focus
    Then the card that has the focus is in the column "Backlog"
    When I press the right arrow until a card in the column "Done" has the focus
    And I press Enter on that card
    Then that card opens

  Scenario: A phone-width board shows one column at a time, picked by its button
    Given I open the board of the demo project at a phone's width
    Then the board shows only the column "Backlog"
    When I pick the column "Done" from the board's column buttons
    Then the board shows only the column "Done"
