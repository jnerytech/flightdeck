@bell-answers
Feature: Answer from the bell
  A request that waits for the person is answered in the bell, in its row, without opening its session.

  Scenario: Approve a request from the bell at a phone's width
    Given a session named "Bell approve" on "alfa" is waiting for me to approve a command
    And the bell holds the request of "Bell approve"
    When I open the bell at a phone's width
    Then the request of "Bell approve" shows its risk and the buttons Approve and Deny
    And the request row fits inside the panel
    When I approve the request of "Bell approve" from the bell
    Then the request of "Bell approve" leaves the bell
    And the status says "Bell approve" was "approved"

  Scenario: Deny a request with the N key on its title
    Given a session named "Bell deny" on "alfa" is waiting for me to approve a command
    And the bell holds the request of "Bell deny"
    When I open the bell at a phone's width
    And I press the key "n" on the title of that request in the bell
    Then the request of "Bell deny" leaves the bell
    And the status says "Bell deny" was "denied"
