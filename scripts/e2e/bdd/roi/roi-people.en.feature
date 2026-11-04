Feature: Token budget per person against delivery

  Scenario: A person sees tokens used against the limit and what was delivered
    Given the person "Ana" owns the host "alfa" and has a monthly limit of 5 million tokens
    And "alfa" used 3.1 million tokens and delivered 7 cards and 4 PRs this month
    When I open the people table in Costs
    Then the row of "Ana" shows "62% of 5 million tokens used"
    And it shows "7 cards, 4 PRs" and "0.44 million tokens per card"

  Scenario: The people table is not a ranking
    Given two people with different delivery
    When I open the people table
    Then the rows are ordered by name
    And the page says that hosts are not people and the figures are correlated
