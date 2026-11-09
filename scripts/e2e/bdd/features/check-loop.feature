@check-loop
Feature: Keep going until the checks pass
  A card with the switch on runs the project's checks when a turn ends. When one fails, its output
  goes back to the same session as the next round, up to the round limit; then the card goes to review
  with the last result on it. A message from the person ends the loop.

  Scenario: A failing check sends a round, and the card ends in review once the checks pass
    Given a git project of my own with a check that passes once the session has written a file is added to host "alfa"
    And I trust that project
    And the project's check is its script
    When I turn on keep going until the checks pass on a new card of that project and start it
    Then the card says the checks passed
    And the session was sent "1" rounds of the loop
    And the board shows the card in the column "In review"

  Scenario: A check that keeps failing stops at the round limit, with the last result on the card
    Given a git project of my own with a check that always fails is added to host "alfa"
    And I trust that project
    And the project's check is its script
    When I turn on keep going until the checks pass on a new card of that project and start it
    Then the card says the checks still failed after "3" rounds
    And the session was sent "3" rounds of the loop
    And the board shows the card in the column "In review"

  Scenario: A message from the person while the checks run ends the loop
    Given a git project of my own with a check that takes a long time is added to host "alfa"
    And I trust that project
    And the project's check is its script
    When I turn on keep going until the checks pass on a new card of that project and start it
    And I send the card a message of my own while its checks run
    Then the card says the loop stepped aside
    And the session answered that message
    And the session was sent "0" rounds of the loop
