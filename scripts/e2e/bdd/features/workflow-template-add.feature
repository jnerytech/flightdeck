@workflow-template-add
Feature: Add a workflow template to a project from the app
  A template is committed on a new branch and opened as a pull request; the base branch does not change.

  Scenario: A template becomes a pull request
    Given a git project of my own with a remote and GitHub as its PR host is added to host "alfa"
    When I add the workflow template "alert-fixer" to that project from its Workflows page
    Then the page says a pull request was opened from a new branch and offers to view it
    And the project's base branch and checkout are untouched and the remote has the new branch
