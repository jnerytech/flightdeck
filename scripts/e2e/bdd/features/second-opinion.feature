@second-opinion
Feature: A second opinion on a card's changes
  Before opening a PR, a person can ask for a second Claude call to read the card's diff. Its findings
  become reviewer drafts in the changes, the ones on no changed line are listed apart, and Open PR
  says what is still open. A card with nothing changed has nothing to ask about.

  Scenario: Asking for a second opinion shows the wait, then the findings as drafts and a loose note
    Given a git project of my own with a remote and GitHub as its PR host is added to host "alfa"
    And the app holds the second-opinion request until I let it go
    When I finish a card of my own that changed two lines
    And I ask for a second opinion
    Then the second opinion says it is reading and cannot be asked again
    When I let the held request go
    Then the second opinion gives its summary
    And it says "2" findings are drafts below
    And it lists "1" finding that is on no changed line
    And the changes hold "2" drafts from the reviewer

  Scenario: Open PR says how many reviewer findings are still open
    Given a git project of my own with a remote and GitHub as its PR host is added to host "alfa"
    When I finish a card of my own that changed two lines
    And I ask for a second opinion
    And the changes hold "2" drafts from the reviewer
    And I ask to open the pull request
    Then the dialog says "2" reviewer findings are not addressed, "1" of them high

  Scenario: A card with no changes cannot ask for a second opinion
    Given a git project of my own with a remote and GitHub as its PR host is added to host "alfa"
    When I finish a card of my own that changed nothing
    Then the second opinion is off and says the card has no changes to review

  Scenario: Go to the drafts puts the focus on the reviewer's first draft
    Given a git project of my own with a remote and GitHub as its PR host is added to host "alfa"
    When I finish a card of my own that changed two lines
    And I ask for a second opinion
    And the changes hold "2" drafts from the reviewer
    And I press Go to the drafts
    Then the focus is on the reviewer's first draft

  Scenario: The focus comes back to the button once the review ends
    Given a git project of my own with a remote and GitHub as its PR host is added to host "alfa"
    And the app holds the second-opinion request until I let it go
    When I finish a card of my own that changed two lines
    And I ask for a second opinion
    And I let the held request go
    Then the second opinion gives its summary
    And the focus is on the button that asks for a second opinion
