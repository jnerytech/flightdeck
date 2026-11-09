@pull-requests
Feature: Pull requests
  One page lists every open pull request on the hosts, with what to do next. A pull request whose
  checks do not fail can be merged from the page, after asking; one whose checks fail cannot.

  Scenario: The open pull requests of every host are on one page
    When I open the Pull requests page
    Then it lists the pull request of the card on alfa that can be merged
    And it lists the pull request of the card on beta with failing checks

  Scenario: Only a pull request whose checks do not fail offers Merge PR
    When I open the Pull requests page
    Then the pull request on alfa offers Merge PR
    And the pull request on beta with failing checks does not

  Scenario: Merge PR asks first, and cancelling leaves the pull request open
    Given the app counts the merges it asks of the hosts
    When I open the Pull requests page
    And I ask to merge the pull request on alfa
    Then the dialog shows the address of that pull request
    When I cancel the merge
    Then the pull request on alfa offers Merge PR
    And no merge was asked of any host

  Scenario: A merge the host refuses is told on the page and the pull request stays
    Given the app counts the merges it asks of the hosts
    When I open the Pull requests page
    And I ask to merge the pull request on alfa
    And I choose to squash and merge
    Then the page says the merge waits for a review
    And one merge was asked of the host
    And the pull request on alfa offers Merge PR
