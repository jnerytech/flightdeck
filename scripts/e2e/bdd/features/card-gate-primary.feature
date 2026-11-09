@card-gate-primary
Feature: A card at a gate leads with the gate
  While a workflow waits at a gate, the gate's Approve is the one thing the card asks for.

  Scenario: The card waiting at a gate shows no second main button
    Given I open the board of the demo project
    When I open the card that waits at a workflow gate
    Then the gate offers Approve and Deny
    And the card's run panel has no main button, only its menu
