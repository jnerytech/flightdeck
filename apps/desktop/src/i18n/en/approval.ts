/** The devices that approve for the person, on a host's page (#3439). */
export const approval = {
  approvalDevices: {
    title: "Approving devices",
    hint: "A high-risk allow, or one that saves a rule, is signed by a device you enroll here. With none enrolled, holding the button is the only check.",
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
    scope:
      "This guards approvals made from the app. Anyone with a terminal on the host can still reset it.",
    loading: "Reading the host's devices…",
    loadFailed: "The host's devices could not be read.",
    noKeyHere:
      "This device has no approving key on this host. Enroll it on the host's page, or approve at the host.",
    hasKeyHere: "This device already has a key for this host.",
  },
};
