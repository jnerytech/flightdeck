@budgets-quota
Feature: Budgets as a share of the plan quota
  On a subscription the plan window runs out, not the dollars: a budget can be a share of the 5-hour
  or the weekly window, and Costs leads with the plan quota.

  Scenario: A host budget of a tenth of the 5-hour window is measured against the plan and is already past
    Given I am on the budgets of host "alfa"
    When I add a host budget of "10" percent of the "5-hour" window that notifies
    Then the list shows that budget as "10%" of the plan and past its limit
    And I remove that budget

  Scenario: A project budget in the weekly window says it is an estimate, and can be edited into dollars
    Given I am on the budgets of host "alfa"
    When I add a budget for a project of my own of "25" percent of the "weekly" window that notifies
    Then the list shows that budget as "25%" of the plan and marked as an estimate
    When I edit that budget into dollars with a limit of "10"
    Then the list shows that one budget in dollars and not as a share of the plan
    And I remove that budget

  Scenario: A project budget in the 5-hour window can hold new cards
    Given I am on the budgets of host "alfa"
    When I add a budget for a project of my own of "80" percent of the "5-hour" window that holds new cards
    Then the list shows that budget holding new cards
    And I remove that budget

  Scenario: Costs leads with the plan quota of the host
    Given I open the Costs page
    Then the plan quota of host "alfa" leads the page, above the cost charts
