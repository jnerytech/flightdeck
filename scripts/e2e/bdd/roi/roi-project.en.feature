Feature: ROI per project

  Scenario: The project page shows what the agents cost and delivered
    Given the project "shop" had 3 cards finish and 2 PRs merge this month
    And the agents' sessions in "shop" cost 12.00 dollars this month
    When I open the project "shop"
    Then the ROI card shows "3 cards done" and "2 PRs merged"
    And it shows "cost per card 4.00" and "cost per PR 6.00"
    And no estimated value or ROI is shown yet

  Scenario: An hourly rate and hours turn delivered work into an estimated value
    Given the client "Acme" has an hourly rate of 60 dollars
    And the project "shop" belongs to "Acme" and estimates 2 hours per card
    And 3 cards of "shop" were done this month and cost 12.00 dollars
    When I open the project "shop"
    Then the ROI card shows "6 estimated hours" marked as an estimate
    And it shows "estimated value 360.00" and "return on cost (estimate) 29 times"
    And "How is this computed?" lists the hours, the rate and the cost used

  Scenario: Without a rate the cost-per-unit numbers still show
    Given no hourly rate is set for "shop" or its client
    When I open the project "shop"
    Then the ROI card shows "set an hourly rate to see the estimated value"
    And the cost per card is still shown

  Scenario: Rework is shown next to the ratio
    Given a PR of "shop" needed 2 fix rounds that cost 1.50 dollars
    When I open the project "shop"
    Then the ROI card shows a rework line with "2 fix rounds" and "1.50"

  Scenario: Cards without an estimate are counted, not hidden
    Given 2 of the 3 done cards of "shop" have no hours and the project has no default
    When I open the project "shop"
    Then the estimated hours are those of the 1 card that has them
    And the card says "2 cards without an estimate"

  Scenario: The period is compared with the one before
    Given "shop" delivered 2 cards at 5.00 each last month and 3 cards at 4.00 each this month
    When I open the project "shop"
    Then the ROI card shows "cost per card down 20% from last month"

  Scenario: The Costs screen ranks the projects and exports them
    Given the projects "shop" and "blog" have different ROI this month
    When I open Costs and sort the projects table by return on cost
    Then the best project is first
    And pressing "Export CSV" saves a file with one row per project and the derivation of each figure

  Scenario: My review time counts only when I ask for it
    Given requests of "shop" waited 3 hours in total for me this month
    When I open the project "shop"
    Then the card says "requests waited 3 h for you" as information and the cost does not include it
    When I turn on "count my review time" with a cap of 5 minutes
    Then the cost includes at most 5 minutes for each decision

  Scenario: A host that is offline does not erase the project
    Given "shop" has work on two hosts and one of them is offline
    When I open the project "shop"
    Then the figures of the online host show, and the other host's figures are marked "as of" their last time
