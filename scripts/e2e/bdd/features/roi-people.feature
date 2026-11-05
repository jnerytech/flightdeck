@roi-people
Feature: Token budget per person
  A person groups hosts and has a monthly limit; the Costs screen lists people by name.

  Scenario: A person is set up with a monthly token limit and listed by name
    Given I am on the Costs screen
    When I add the person "Ana" on the first host with a monthly limit of "5000000" tokens
    Then the people table lists "Ana" against a limit of 5 million tokens
