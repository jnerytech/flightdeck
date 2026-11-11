/** The backup of a host's data, now and on a schedule. */
export const backup = {
  backupAll: {
    title: "Back up everything",
    intro:
      "One encrypted file with your settings, personas, snippets, hosts (with their tokens) and the vault. Only the passphrase you choose opens it.",
    exportTitle: "Back up",
    passphrase: "Passphrase",
    confirm: "Confirm passphrase",
    passphraseHelp: "At least 12 characters. Without it the backup cannot be opened.",
    export: "Back up now",
    exportNeeds: "Type the passphrase and repeat it.",
    saved:
      "Backup saved, where you chose. Keep the passphrase: without it the backup does not open.",
    importTitle: "Restore a backup",
    sourceLegend: "Restore from",
    source: { file: "A file", drive: "Google Drive" },
    driveLook: "Look in Google Drive",
    driveNone: "No backups on Google Drive yet.",
    driveChoiceLegend: "Backups on Google Drive",
    driveNeedsSignIn: "Sign in to Google under Scheduled backups first.",
    driveReadNeeds: "Choose a backup and type its passphrase.",
    filePassphrase: "File passphrase",
    read: "Read backup",
    needsDesktop: "Restoring a backup needs the desktop app: a browser cannot open files.",
    readNeeds: "Type the file's passphrase.",
    kinds: {
      settings: "Settings",
      personas: "Personas",
      snippets: "Snippets",
      hosts: "Hosts",
      vault: "Vault",
    },
    line: "{kind}: {added} new, {same} the same, {conflicting} different",
    conflictList: "Different here",
    newHosts: "New hosts",
    choiceLegend: "When it differs",
    nothingToRestore: "Nothing here is new. Choose to replace a difference to restore it.",
    keep: "Keep what is here",
    replace: "Replace with the backup",
    restore: "Restore",
    replaceMessage: "Replace {names} with what is in the backup? What is here is lost.",
    replaceConfirm: "Replace",
    result:
      "Restored: {added} new, {overwritten} replaced, {skipped} kept. Close and reopen Flightdeck to use them.",
    error: {
      "short-passphrase": "The passphrase needs at least 12 characters.",
      mismatch: "The passphrases do not match.",
      unreadable:
        "The file could not be read. Check the passphrase; a changed file is refused too.",
      failed: "The restore failed and nothing was changed.",
      "drive-auth":
        "Google Drive does not accept the sign-in. Sign in again under Scheduled backups.",
      "drive-failed": "Google Drive could not be read. Try again.",
      unexpected: "Something went wrong. Nothing was changed.",
      "too-big":
        "This backup is too big to be restored later (over 1 MiB), so it was not saved. Remove large personas or snippets and try again.",
    },
  },
  backupSchedule: {
    title: "Scheduled backups",
    intro:
      "A backup is made on its own into a folder you choose, and only the last few files stay. The passphrase is asked once each time the app starts and stays in memory.",
    cadenceLegend: "How often",
    cadence: { off: "Off", daily: "Every day", weekly: "Every week" },
    folder: "Folder",
    noFolder: "No folder chosen",
    chooseFolder: "Choose folder",
    targetLegend: "Where to save",
    target: { folder: "A folder", drive: "Google Drive" },
    driveHelp:
      "Backups go to Flightdeck's own hidden folder in your Google Drive. Only this app can see it, and each file stays encrypted with your passphrase.",
    driveSignedIn: "Signed in to Google",
    driveSignedOut: "Not signed in to Google",
    driveSignIn: "Sign in with Google",
    driveSignOut: "Sign out",
    driveRefused: "Google did not accept the sign-in. Try again.",
    keep: "Files to keep",
    keepInvalid: "Type a whole number from 1. The saved number ({count}) stays.",
    passphrase: "Passphrase for this session",
    passphraseHelp:
      "At least 12 characters. Kept in memory until you close Flightdeck, never saved.",
    usePassphrase: "Use it",
    passphraseNeeds: "Type a passphrase of at least 12 characters.",
    passphraseSet: "Passphrase set until you close Flightdeck.",
    lastRun: "Last backup: {when}",
    neverRun: "No scheduled backup yet.",
    pruneFailed: "The backup was saved, but the old files could not be removed.",
    attention: {
      passphrase: {
        title: "Scheduled backups need your passphrase",
        body: "Type it in Settings, section Backup. Until then no backup is made.",
      },
      "no-folder": {
        title: "Scheduled backups have no folder",
        body: "Choose a folder in Settings, section Backup. Until then no backup is made.",
      },
      failed: {
        title: "A scheduled backup failed",
        body: "Check that the folder still exists and has room, in Settings, section Backup.",
      },
      "drive-auth": {
        title: "Scheduled backups to Google Drive need you to sign in",
        body: "Sign in again in Settings, section Backup. Until then no backup is made.",
      },
    },
    skipped: {
      "no-folder": "A backup is due, but no folder is chosen. Choose a folder.",
      "no-passphrase": "A backup is due, but it waits for the passphrase. Type it below.",
      failed:
        "The last backup could not be saved. Check that the folder still exists and has room.",
      "drive-auth": "A backup is due, but Google Drive is not signed in. Sign in again.",
    },
  },
};
