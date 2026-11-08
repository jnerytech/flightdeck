@backup
Feature: Back up everything
  Settings > Backup saves one encrypted file, and a restore previews it before it changes anything.

  Scenario: Back up everything into one encrypted file
    Given I am on Settings > Backup and files are saved into the page
    When I back up everything with a passphrase
    Then the panel says the backup was saved
    And the saved file is encrypted and does not hold the passphrase

  Scenario: Passphrases that differ save nothing
    Given I am on Settings > Backup and files are saved into the page
    When I back up everything with two passphrases that differ
    Then the panel says the passphrases do not match and nothing was saved

  Scenario: A wrong passphrase reads nothing, and the right one only previews
    Given I am on Settings > Backup and files are saved into the page
    When I back up everything with a passphrase
    Then the panel says the backup was saved
    When I read that backup with a wrong passphrase
    Then the panel says the file could not be read and offers no Restore
    When I read that backup with its passphrase
    Then the panel previews what the backup holds and nothing is restored yet
