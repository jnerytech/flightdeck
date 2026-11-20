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
    retry: "Try again",
    loadFailed: "The host's devices could not be read.",
    noKeyHere:
      "This device has no approving key on this host. Approve from a device that has one, or reset protection at the host's terminal with flightdeckd approvers reset and enroll this device again.",
    hasKeyHere: "This device already has a key for this host.",
    heardEnrolled:
      "A device named “{name}” was enrolled on {host}. If it was not you, revoke it on the host's page.",
    heardRevoked: "A device was revoked on {host}.",
    heardRevokedOwn:
      "This device's key was revoked on {host}. It can no longer approve there; enroll it again to approve from here.",
    dismiss: "Dismiss",
  },
};
