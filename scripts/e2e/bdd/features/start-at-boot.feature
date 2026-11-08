@start-at-boot
Feature: Start at boot
  The app turns the host's service on only for a daemon that runs the installed binary; any other shows the command to run by hand.

  Scenario: A host run from source shows the command and no Turn it on
    When I open the health of host "alfa"
    Then the Service row says it is missing and shows the command to run by hand
    And the app does not offer Turn it on, because this host does not run the installed binary
