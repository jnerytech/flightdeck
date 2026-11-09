@while-away
Feature: While you were away
  After a long absence, Needs you opens with a summary of what each host did while the app was
  closed. Every line goes to the thing it names. A short absence, or one with nothing new, has no
  summary, and a host that does not answer is named.

  Scenario: After a long absence the summary says what each host did
    Given the app was last active long ago
    When I open Needs you
    Then the summary tells what alfa did: finished sessions, cards in review and the quota used
    And the summary tells what beta did: a merged pull request, a pull request with failing checks and cards in review

  Scenario: A line of the summary goes to the card it names
    Given the app was last active long ago
    When I open Needs you
    And I follow the merged pull request line of beta
    Then the card of that pull request opens
    And the summary is gone

  Scenario: A run that failed while the app was closed is listed
    Given a git project of my own with a workflow that fails is added to host "alfa"
    And I trust its workflow
    When I start a card of my own on that project with its workflow
    Then the card offers Run again once the run has failed
    Given the app was last active long ago
    When I look at my card
    And I go to Needs you from the sidebar
    Then the summary lists the failed run of my card under alfa
    When I follow the failed run line of alfa
    Then my card opens

  Scenario: Dismiss closes the summary
    Given the app was last active long ago
    When I open Needs you
    And I dismiss the summary
    Then the summary is gone

  Scenario: With nothing new since the app was last active there is no summary
    Given the app was last active a moment ago
    And two hours pass
    When I open Needs you
    Then there is no summary

  Scenario: A host that does not answer is named
    Given the app was last active long ago
    And host beta does not answer what happened while the app was closed
    When I open Needs you
    Then the summary tells what alfa did: finished sessions, cards in review and the quota used
    And the summary says beta did not answer
