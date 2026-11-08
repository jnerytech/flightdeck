@add-host-guide
Feature: Add a host with the first-run guide
  A person who already has a host sees the same setup steps when adding another, and a pairing link fills the form.

  Scenario: The guide is on the page, with the manual fields folded away
    When I open the Add a host page
    Then the page lists the first steps with copy buttons for setup and doctor
    And the address and token fields are folded away and the pairing link is in view

  Scenario: A pasted pairing link opens the manual fields on its name
    When I open the Add a host page
    And I paste a pairing link named "orange pi"
    Then the manual fields open with the name "orange pi"
