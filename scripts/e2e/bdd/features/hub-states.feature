@hub-states
Feature: Session states in the sessions list
  Each row of the sessions list says in words what its session is doing, and its group counts the active ones.

  Scenario: A session waits for me, then goes idle once I approve it
    Given a session named "BDD list state" waits for approval in a folder of its own
    When I open the sessions list
    Then its project group has a session that says "Waiting for you"
    And that session says which tool it wants to run, "Bash"
    And its project group counts its active sessions
    When I open the queue of what needs me
    And I open the request of "BDD list state"
    And I press the key "a" on the request
    And I open the sessions list
    Then its project group has a session that says "Idle"
