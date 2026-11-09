@start-elsewhere
Feature: Start a card on another host
  When a host would make a started card wait, the Start confirm offers another host that holds the
  same project. The card starts there and the first copy is marked and leaves the queue; a host
  that cannot take it is not offered, and one that refuses it leaves the card as it was.

  Scenario: A card that would wait on a paused host starts on a second host
    Given a git project of my own with a remote is added to host "alfa"
    And the same project is added to host "beta"
    And new runs are not paused on host alfa
    When I pause new runs on host alfa
    And I select a card of my own on that project and ask to start it
    Then the confirm offers to start it on host "beta"
    When I choose to start it on host "beta"
    Then the board says the card started on host "beta"
    And the card is in the column "Done"
    And the card says it started on host "beta"
    And host beta runs a copy of the card
    When I resume new runs on host alfa

  Scenario: A host without the project is not offered
    Given a git project of my own with a remote is added to host "alfa"
    And the app notes what host beta answers about its projects
    And new runs are not paused on host alfa
    When I pause new runs on host alfa
    And I select a card of my own on that project and ask to start it
    Then the confirm offers no other host to start it on
    When I resume new runs on host alfa

  Scenario: A host that refuses the card leaves it queued and unchanged
    Given a git project of my own with a remote is added to host "alfa"
    And the same project is added to host "beta"
    And host beta refuses to start the cards it is handed
    And new runs are not paused on host alfa
    When I pause new runs on host alfa
    And I select a card of my own on that project and ask to start it
    And I choose to start it on host "beta"
    Then the board says the card did not start
    And the card is in the column "Backlog"
    And the card does not say it started on any host
    And host beta has no copy of the card
    When I resume new runs on host alfa
