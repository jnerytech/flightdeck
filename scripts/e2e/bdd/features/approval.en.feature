@approval-with-a
Feature: Approval
  A session that wants to run a command waits for the person's answer.

  Scenario: Approve a request with the A key
    Given a session named "BDD approval" on "alfa" is waiting for me to approve a command
    When I open the queue of what needs me
    And I open the request of "BDD approval"
    And I press the key "a" on the request
    Then the request of "BDD approval" leaves the queue
