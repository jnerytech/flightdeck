/** The devices that approve for the person, on a host's page (#3439). */
export const approval = {
  approvalDevices: {
    title: "Approving devices",
    hint: "A high-risk allow, one that saves a rule, the use of a production or high-risk secret and the merge of a pull request are signed by a device you enroll here. With none enrolled, holding the button is the only check.",
    off: "Protection is off: no device is enrolled on this host.",
    on: "Protection is on: these devices can approve.",
    listLabel: "Enrolled devices",
    thisDevice: "This device",
    elsewhere: "Another device",
    detail: "{client} · {address} · enrolled {date}",
    revoke: "Revoke",
    revokeLabel: "Revoke {name}",
    revoked: "Device revoked.",
    enrollTitle: "Enroll this device",
    enrollHint:
      "On the host's terminal run flightdeckd approvers enroll, then type the code it prints. The code works once, for ten minutes.",
    nameLabel: "Name of this device",
    codeLabel: "One-time code",
    enroll: "Enroll",
    enrolled: "This device is enrolled.",
    removeLocal: "Remove this device's key",
    removeLocalHint:
      "The host keeps listing the device until another enrolled device revokes it, or until you reset it at the host.",
    removedLocal: "This device's key was removed.",
    lost: "Protection was on and the host now lists no device. If you did not reset it at the host, someone with access to it did.",
    commandsUnchecked:
      "This host does not ask for a device to confirm a merge: update it to protect merges.",
    trustUnchecked:
      "This host does not ask for a device to confirm trusting a folder: update it to protect trust.",
    bypassUnchecked:
      "This host does not ask for a device to turn on Bypass permissions: update it to protect that switch.",
    resumeUnchecked:
      "This host does not ask for a device to confirm turning automatic approval back on: update it to protect it.",
    rootsUnchecked:
      "This host does not ask for a device to add an allowed folder: update it to protect the list of folders.",
    pluginsUnchecked:
      "This host does not ask for a device to confirm installing or updating a plugin: update it to protect the code its sessions run.",
    marketplaceUnchecked: "marketplace unchecked",
    harnessUnchecked:
      "This host does not ask for a device to confirm writing a project's Claude Code setup: update it to protect what runs in its sessions.",
    scope:
      "This guards approvals made from the app. Anyone with a terminal on the host can still reset it.",
    loading: "Reading the host's devices…",
    retry: "Try again",
    loadFailed: "The host's devices could not be read.",
    noKeyHere:
      "This device has no approving key on this host. Approve from a device that has one, or reset protection at the host's terminal with flightdeckd approvers reset and enroll this device again.",
    hasKeyHere: "This device already has a key for this host.",
    addTitle: "Add another device",
    addHint:
      "On the new device, open this host's page, choose “Show the text” and paste what it shows here. A system dialog then asks you to confirm.",
    addTextLabel: "Text from the new device",
    addRead: "Read",
    addOfferTitle: "Add this device?",
    addOfferFor: "Device “{name}”, for host {host}.",
    addOfferCode: "Code:",
    addOfferHint:
      "Add it only if the new device shows the same code. The name is only a label; the code is what shows it is the same device.",
    addConfirm: "Add this device",
    addCancel: "Cancel",
    addDone: "The device was added.",
    addDeclined: "Nothing was changed.",
    requestTitle: "Add this device to this host",
    requestHint:
      "Make a text here and paste it on a device that is already enrolled, in this host's page. That device shows the same code before it adds this one.",
    requestShow: "Show the text",
    requestTextLabel: "Text for the enrolled device",
    requestWaiting: "Waiting for the other device to add this one.",
    requestCheck: "Check again",
    addBadText:
      'That is not a text made by another device\'s "Show the text" button. Copy it again, whole.',
    addOtherHost:
      "That text was made for another host. Make it again on the device, with this host open.",
    addBadName: "A name has 1 to 64 characters, with no hidden characters, and is not a code.",
    addAlready: "That device is already enrolled on this host.",
    heardEnrolled:
      "A device named “{name}” was enrolled on {host}. If it was not you, revoke it on the host's page.",
    heardRevoked: "A device was revoked on {host}.",
    heardRevokedOwn:
      "This device's key was revoked on {host}. It can no longer approve there; enroll it again to approve from here.",
    dismiss: "Dismiss",
  },
};
