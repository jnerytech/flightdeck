@new-session
Feature: New session
  A person starts a session on a host from the New session screen.

  Scenario: Start a session with a first prompt
    Given I am on the new session screen of host "alfa"
    When I write the first prompt "list the files"
    And I create the session
    Then the session opens showing my prompt "list the files"
