@roi-headline
Feature: Did we deliver more?
  The project page starts from what was delivered, against the period before.

  Scenario: The project page says it delivered more than the period before
    Given the demo project finished more cards this month than in the period before
    When I open the board of the demo project
    Then the return on cost card says it delivered more than the period before
