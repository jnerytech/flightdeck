@palette-start
Feature: Start a session from the palette
  Text typed in the command palette can start a session in the project on screen, with the text as its task.

  Scenario: Start in the project of the board I am looking at
    Given I open the board of the demo project
    When I open the command palette
    And I type "write the palette notes" in the palette
    And I choose to start a session in "flightdeck-web" with that text
    Then the session opens showing my prompt "write the palette notes"
