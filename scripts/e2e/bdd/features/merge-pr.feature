@merge-pr
Feature: Merge PR
  A card whose pull request is open offers Merge PR. When GitHub holds the merge for a review, the
  card says so, and nothing is merged.

  Scenario: A merge that waits for a review is refused and the card keeps its pull request
    Given I open the board of the demo project
    When I open the card whose pull request is open and ask to merge it
    And I choose to squash and merge
    Then the card says the merge waits for a review and links to the pull request
    And the card still offers Merge PR

  Scenario: Cancelling the merge leaves the pull request open
    Given I open the board of the demo project
    When I open the card whose pull request is open and ask to merge it
    And I cancel the merge
    Then the card still offers Merge PR
