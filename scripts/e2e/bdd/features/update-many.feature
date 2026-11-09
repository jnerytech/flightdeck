@update-many
Feature: Update several cards from the base
  Cards that fell behind their base branch are brought up to date together, one at a time. The summary
  names each outcome, and a card that conflicts is left exactly as it was.

  Scenario: Three selected cards are updated, found current, or left in conflict
    Given a git project of my own is added to host "alfa"
    When I start two cards of my own on that project, the first committing a file
    And the base branch gets a commit that adds the same file with other text
    And I start a third card of my own on that project
    And I select the three cards and update them from the base
    Then the summary names the card updated, the one already current and the one in conflict
    And the card in conflict is left as it was
    And the updated card holds the base commit
