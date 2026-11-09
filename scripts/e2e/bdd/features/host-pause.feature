@host-pause
Feature: Pause new runs on a host
  Before restarting or updating a host, a person pauses its new runs: a card they start waits, the
  status bar keeps the pause in sight, and resuming lets the card start.

  Scenario: A card started while new runs are paused waits, and resuming lets it start
    Given a git project of my own is added to host "alfa"
    And new runs are not paused on host alfa
    When I pause new runs on host alfa
    And I start a card of my own on that project from its main button
    Then the card says it waits because the host is paused
    And the status bar names host alfa as paused
    When I resume new runs on host alfa
    Then the card starts and no longer waits for the pause
