@backup-schedule
Feature: Scheduled backups
  A backup is made on its own into a folder, the last few files stay, and the passphrase is asked
  again each time the app starts, since it lives in memory only.

  Scenario: A daily schedule waits for the passphrase, then saves a backup
    Given I am on Settings > Backup with a folder for scheduled backups
    When I turn on the daily backup and choose the folder
    Then the page says a backup is due and waits for the passphrase
    When I give the schedule a passphrase
    Then the page says the passphrase is set and when the last backup was made
    And the folder holds "1" backup file

  Scenario: After a restart the schedule is kept and the passphrase is asked again
    Given I am on Settings > Backup with a folder for scheduled backups
    When a daily backup was made into the folder
    And I restart the app
    Then the daily backup is still on, with its folder
    And the passphrase is asked again

  Scenario: Only the last file stays when the schedule keeps one
    Given I am on Settings > Backup with a folder for scheduled backups
    When I set the schedule to keep "1" file
    And a daily backup was made into the folder
    And two days pass and I restart the app
    And I give the schedule a passphrase
    Then the folder holds "1" backup file
    And that file is a newer backup than the first one
