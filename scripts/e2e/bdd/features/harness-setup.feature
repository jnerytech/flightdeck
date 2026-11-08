@harness-setup
Feature: Set up Claude Code
  A person gives a project the files Claude Code reads, sees them first, and keeps them on a branch.

  Scenario: Preview, apply and commit the setup of a project
    Given a git project of my own is added to host "alfa"
    When I open that project
    And I preview the Claude Code setup
    Then the preview lists "CLAUDE.md" among the new files
    When I apply the setup
    Then the setup says which files it wrote
    When I commit the setup on a new branch
    Then the setup says it was committed on a branch
