@conflict-radar
Feature: Conflict radar
  Two cards of a project that change the same file are flagged on both, so the person knows that
  whoever merges second may have to resolve conflicts.

  Scenario: Two cards that change the same file both say they may conflict
    Given a git project of my own is added to host "alfa"
    When I start two cards of my own on that project that each commit a file
    Then each card on the board says it may conflict with the other
    And the first card lists the other card and the file the two share

  Scenario: The Merge PR confirm names the card that changes the same files
    Given a git project of my own with a remote and GitHub as its PR host is added to host "alfa"
    When I start two cards of my own on that project that each commit a file
    And I open the pull request of the first card
    And I ask to merge the first card's pull request
    Then the confirm says the other card changes the same files
