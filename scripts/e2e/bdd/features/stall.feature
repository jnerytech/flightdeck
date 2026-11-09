@stall
Feature: A session that says nothing
  A session that is marked as running but has produced nothing for a while is listed under Needs you,
  with the ways to get it going again. Interrupting it takes it off the list.

  Scenario: A quiet session shows up in the queue and leaves it when I interrupt it
    Given a session named "BDD quiet" on "alfa" is running and says nothing
    When I open the queue of what needs me
    Then the queue lists "BDD quiet" as quiet
    When I choose the quiet session "BDD quiet"
    Then its detail offers to open it, interrupt it, send continue and snooze it
    When I interrupt the quiet session
    Then the queue no longer lists "BDD quiet" as quiet
