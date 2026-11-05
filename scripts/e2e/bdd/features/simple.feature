@simple-mode
Feature: Simple mode
  Someone who never opens a terminal starts a task, answers a plain question and gets a file.

  Scenario: Start a task, answer yes and see its result
    Given simple mode is on for "alfa"
    When I start the task "Write a summary" on the notes folder
    And I answer yes to the question
    Then the task is done
    And the file "summary.md" is listed among the task's files

  Scenario: Switch to the full app and back
    Given simple mode is on for "alfa"
    When I choose to show everything in the settings
    Then the full app shows
    When I go back to simple mode from the page of host "alfa"
    Then the home of simple mode shows
