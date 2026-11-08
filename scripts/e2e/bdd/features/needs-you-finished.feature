@needs-you-finished
Feature: Finished sessions in Needs you
  A session whose turn ends while the person is elsewhere is listed under Needs you, with a way to its changes.

  Scenario: A session finishes while I am on Needs you, and I see its changes
    Given a session named "BDD finished" on "alfa" is waiting for me to approve a command
    When I open the queue of what needs me
    And I open the request of "BDD finished"
    And I press the key "a" on the request
    Then no request of "BDD finished" is waiting any more
    And the Finished group lists "BDD finished" as finished
    When I choose the finished session "BDD finished"
    Then its detail names the session, how it ended, and offers to see the changes
    When I choose to see the changes
    Then the session opens on its Changes view

  Scenario: Leaving Needs you is the look: coming back, the Finished group is gone
    Given a session named "BDD looked" on "alfa" is waiting for me to approve a command
    When I open the queue of what needs me
    And I open the request of "BDD looked"
    And I press the key "a" on the request
    Then the Finished group lists "BDD looked" as finished
    When I choose the finished session "BDD looked"
    And I choose to see the changes
    And I go back to the queue of what needs me
    Then the Finished group is gone
