@ssh
Feature: SSH connections
  Connections keeps the SSH destinations of a host: add one by hand, remove it after a question, import names from the host's SSH config, or connect to one that asks for a password.

  Scenario: A destination added by hand is listed, and removing it asks first
    Given I am on Connections
    When I add the destination "build" as "deploy@build.example.test"
    Then the list shows "build" as "deploy@build.example.test"
    When I start to remove "build" and cancel
    Then "build" is still listed
    When I remove "build" and confirm
    Then "build" is no longer listed

  Scenario: A name in the SSH config is imported as a destination
    Given I am on Connections
    When I open the import from the SSH config
    Then the import offers "lab" to tick
    When I import only "lab"
    Then the page says one destination was created and the list shows "lab" with the user and host the config gave it
    When I remove "lab" and confirm
    Then "lab" is no longer listed

  Scenario: A destination that asks for a password connects once the host's prompt is answered
    Given I am on Connections
    When I add the destination "pw" that asks for a password
    And I connect to "pw" and confirm its server key
    Then the host asks for the password of "pw"
    When I send the password
    Then the terminal shows that the password was accepted
    When I end the terminal
    Given I am on Connections
    When I remove "pw" and confirm
    Then "pw" is no longer listed
