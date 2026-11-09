@memory-hold
Feature: New cards wait while the host is short of memory
  From the memory share the person sets, a new card waits on the host and starts when memory frees
  up; with no reading of the memory, nothing waits.

  Scenario: A card waits at 95% of memory and starts when memory falls
    Given a git project of my own is added to host "alfa"
    And host alfa holds new cards from "95%" of memory and reads "96%" in use
    When I start a card of my own on that project from its main button
    Then the card says it is waiting for memory
    When the memory of host alfa falls to "50%" in use
    Then the card starts and no longer waits for memory
    And I put the memory hold of host alfa back to what it was

  Scenario: A host with no memory reading never holds a card
    Given a git project of my own is added to host "alfa"
    And host alfa holds new cards from "95%" of memory and has no memory reading
    When I start a card of my own on that project from its main button
    Then the card starts at once and never waits for memory
    And I put the memory hold of host alfa back to what it was
