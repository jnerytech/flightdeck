@new-session
Feature: New session
  A person starts a session on a host from the New session screen.

  Scenario: Start a session with a first prompt
    Given I am on the new session screen of host "alfa"
    When I write the first prompt "list the files"
    And I create the session
    Then the session opens showing my prompt "list the files"

  Scenario: The task comes first and Ctrl+Enter starts the session
    Given I am on the new session screen of host "alfa"
    Then the first prompt box has the focus
    And the name and the subfolder are folded under More options
    When I write the first prompt "write the notes"
    And I press Ctrl+Enter in the first prompt
    Then the session opens showing my prompt "write the notes"

  Scenario: More options shows the name and the subfolder
    Given I am on the new session screen of host "alfa"
    When I open More options
    Then the name and the subfolder boxes show
