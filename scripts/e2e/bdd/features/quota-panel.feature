@quota-panel
Feature: The quota panel
  The quota in the status bar opens both windows of a host and the guard that makes new cards wait.

  Scenario: Set the guard from the status bar, and the host keeps it
    Given I am on the queue of what needs me
    When I press the quota in the status bar
    Then the panel shows the 5 hours and 7 days windows of host "alfa"
    When I make new cards wait from "70%" on host "alfa"
    Then the guard of host "alfa" reads "70%"
    When I reload the app and open the quota again
    Then the guard of host "alfa" reads "70%"
    And I put the guard of host "alfa" back to what it was
