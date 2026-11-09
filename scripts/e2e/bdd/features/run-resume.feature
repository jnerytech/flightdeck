@run-resume
Feature: Run again from the failed step
  A failed workflow run goes on from the step that failed, without running the finished steps again,
  and says why it cannot when the workflow or the branch changed.

  Scenario: A failed run goes on from its failed step and ends completed
    Given a git project of my own with a two-step workflow whose second step fails once is added to host "alfa"
    And I trust its two-step workflow
    When I start a card of my own on that project with the two-step workflow
    Then the card offers to run again from the failed step
    When I press Run again from the failed step
    Then the run goes on and ends completed
    And the first step ran once

  Scenario: A workflow that changed since the run cannot go on from the failed step
    Given a git project of my own with a two-step workflow whose second step fails once is added to host "alfa"
    And I trust its two-step workflow
    When I start a card of my own on that project with the two-step workflow
    Then the card offers to run again from the failed step
    When the workflow file is changed on the base branch and trusted again
    Then the card says why it cannot go on from the failed step: "run_resume_workflow_changed"

  Scenario: A branch that moved since the run cannot go on from the failed step
    Given a git project of my own with a two-step workflow whose second step fails once is added to host "alfa"
    And I trust its two-step workflow
    When I start a card of my own on that project with the two-step workflow
    Then the card offers to run again from the failed step
    When the card's branch gets a new commit
    Then the card says why it cannot go on from the failed step: "run_resume_branch_moved"
