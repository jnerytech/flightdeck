@run-again
Feature: Run again
  A card whose workflow run failed starts it again from the card.

  Scenario: A failed run starts again with one press
    Given a git project of my own with a workflow that fails is added to host "alfa"
    And I trust its workflow
    When I start a card of my own on that project with its workflow
    Then the card offers Run again once the run has failed
    When I press Run again
    Then the second run of the card completes
