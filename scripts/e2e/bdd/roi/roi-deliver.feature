Feature: Did we deliver more?

  Scenario: The project page leads with delivered items against cost
    Given "shop" delivered 5 planned and 2 unplanned cards this month for 28.00 dollars
    And "shop" delivered 4 planned cards last month for 31.00 dollars
    When I open the project "shop"
    Then the first line says "Delivered 7 (5 planned, 2 unplanned) for 28.00"
    And it says "more than last month, at a lower cost per item"

  Scenario: Delivering about the same is said plainly
    Given "shop" delivered 10 cards this month and 10 cards last month
    When I open the project "shop"
    Then the first line says "about the same as last month"

  Scenario: Nothing delivered still shows the cost
    Given "shop" delivered no card this month and its agents cost 6.00 dollars
    When I open the project "shop"
    Then the first line says "Nothing delivered this month" and shows the cost 6.00
