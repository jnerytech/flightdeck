@first-hour
Feature: The first hour
  A person who opens the app for the first time connects a host with its pairing link, adds a first
  project, makes and starts a first card, and reaches the PR. Each step says what to do next.

  Scenario: A first start asks to connect a host and lists the first steps
    Given the app starts with no host
    Then the screen asks to connect the first host
    And the page lists the first steps with copy buttons for setup and doctor
    And the address and token fields are folded away and the pairing link is in view
    And the first tab and the breadcrumb say to connect a host

  Scenario: The host's pairing link connects it
    Given the app starts with no host
    When I paste the pairing link of the first demo host named "orange pi"
    And I press Test and add
    Then the host "orange pi" shows online in the sidebar

  Scenario: The first card finishes and Needs you lists it
    Given the app starts with no host
    When I paste the pairing link of the first demo host named "orange pi"
    And I press Test and add
    And I add a git repository of my own as my first project from the host page
    And I open the board of my first project from its page
    And I make and start my first card, which commits a file
    And I go to Needs you from the sidebar
    Then Needs you lists my first card as finished

  Scenario: Open PR on a project with a remote and GitHub as its PR host opens the pull request
    Given the app starts with no host
    When I paste the pairing link of the first demo host named "orange pi"
    And I press Test and add
    And I add a git repository of my own with a remote as my first project from the host page
    And I open the settings of my first project from its page
    And I choose GitHub as the PR host of my first project in its settings
    And I open the board of my first project from the projects list
    And I make and start my first card, which commits a file
    And I open the changes of my first card
    And I ask to open the pull request
    Then the dialog offers the PR's title and description to read before it opens
    When I open the PR with that text
    Then the card says its PR is open and offers Merge PR

  Scenario: A pasted pairing link shows dots in place of its token and still connects
    Given the app starts with no host
    When I paste the pairing link of the first demo host named "orange pi"
    Then the pairing link field shows dots in place of the token
    When I press Test and add
    Then the host "orange pi" shows online in the sidebar

  Scenario: A typed pairing link shows dots in place of its token once the field is left
    Given the app starts with no host
    When I type the pairing link of the first demo host named "orange pi"
    And I leave the pairing link field
    Then the pairing link field shows dots in place of the token

  Scenario: A project with no PR provider says so on the card, before any text is typed
    Given the app starts with no host
    When I paste the pairing link of the first demo host named "orange pi"
    And I press Test and add
    And I add a git repository of my own as my first project from the host page
    And I open the board of my first project from its page
    And I make and start my first card, which commits a file
    And I open the changes of my first card
    Then the card says no PR can be opened without a PR provider
    And the card names the branch to push by hand
    And Review changes still leads and Open PR is not offered
