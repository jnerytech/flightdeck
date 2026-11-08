@review-in-message-box
Feature: Review in the message box
  A person comments on lines of a session's changes and edits the review in the message box before sending it.

  Scenario: Comment on a changed line and hand the review over to the message box
    Given a session of my own in a git folder with an edited file "notes.txt"
    When I open the Changes view of the session
    And I comment "Why was this edited?" on line 1 of "notes.txt"
    And I hand the review over to the message box
    Then the message box holds my comment "Why was this edited?" and the session is back on its conversation
    When I send the message
    Then the conversation shows my review with "Why was this edited?"
