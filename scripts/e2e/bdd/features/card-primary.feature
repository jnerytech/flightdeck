@card-primary
Feature: A card leads with its next step
  A card shows one main button for what comes next, and keeps the other actions in a menu.

  Scenario: Start leads, and the rest waits in the menu
    Given I open the board of the demo project
    When I create a card with a title of my own
    And I open that card
    Then its one main button is Start and Finish and Discard wait in its menu
    When I press the main button
    Then the main button now says Review changes, on the same button
