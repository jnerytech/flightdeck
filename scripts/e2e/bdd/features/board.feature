@board
Feature: Board
  A person plans work as cards, moves them across the columns and finishes them.

  Scenario: Create a card, decline to start it and finish it by moving it to Done
    Given I open the board of the demo project
    When I create a card with a title of my own
    Then the card is in the column "Backlog"
    When I ask to start the card and then cancel
    Then the card is in the column "Backlog"
    When I open the card and read the three ways to finish it
    And I finish the card by moving it to Done
    Then the card says it is already done

  Scenario: Move a card to review: the board asks first, since it lacks a PR link
    Given I open the board of the demo project
    When I create a card with a title of my own
    And I move the card to the column "In review" from its menu
    Then the board asks before moving it, saying the card lacks a PR link
    When I move it anyway
    Then the card is in the column "In review"
