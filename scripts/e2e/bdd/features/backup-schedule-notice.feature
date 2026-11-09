@backup-schedule-notice
Feature: Scheduled backups that cannot go reach the bell
  A person who turned on a schedule and never reopens Settings still hears, in the bell, that no
  backup is being made.

  Scenario: After a restart with no passphrase the bell holds one notice that opens the schedule
    Given a daily backup was left scheduled into the demo folder, with no passphrase
    When I restart the app on the queue of what needs me
    And I open the bell
    Then the bell holds one notice that the scheduled backups need the passphrase
    When I press that notice
    Then the schedule opens and asks for the passphrase

  Scenario: The notice is not repeated while the app stays open
    Given a daily backup was left scheduled into the demo folder, with no passphrase
    When I restart the app on Settings > Backup
    And I turn the schedule off and on again
    And I open the bell
    Then the bell holds one notice that the scheduled backups need the passphrase

  Scenario: A schedule with no folder says so instead of asking for the passphrase
    Given a daily backup was left scheduled with no folder
    When I restart the app on the queue of what needs me
    And I open the bell
    Then the bell holds one notice that the scheduled backups have no folder
