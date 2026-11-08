@team-outcome
Feature: Team outcome
  A team's page opens on what its coordinator reported, so a person reads the result without
  opening the sessions.

  Scenario: The active team shows the coordinator's outcome above its workers' reports
    Given I open the Teams page of host "alfa"
    Then the active team shows the coordinator's outcome marked Done
    And the outcome sits above the last report of each worker
    And the outcome can be reached with the keyboard
