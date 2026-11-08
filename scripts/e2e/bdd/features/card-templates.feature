@card-templates
Feature: Card templates
  A project keeps card templates in a file, and New card offers them to a person who trusts the project.

  Scenario: A card made from a template starts with what the template holds
    Given a git project of my own with a card template is added to host "alfa"
    And I trust that project
    When I create a card from the template "Bug fix" with a title of my own
    Then the card is in the column "Backlog"
    And the card starts with the template's criteria, spec file, pinned document and persona

  Scenario: A project that is not trusted says its card templates were not used
    Given a git project of my own with a card template is added to host "alfa"
    When I open New card on the board of that project
    Then New card says the project's card templates were not used because it is not trusted
