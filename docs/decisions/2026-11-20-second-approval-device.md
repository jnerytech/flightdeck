# Enrolling a second approving device from the app (issue #3478)

## What was missing

The first key of a host goes in with the one-time code the host's terminal prints. A second one needs a
signature from a key already enrolled (`enroll-add`, `Approvers.checkAdd`), and the app could not make it:
the device key signed only an allow, an enrollment of itself and a revoke (#3439). A person with two machines
had to reset the host and enroll both again. The daemon needs no change.

## Decision

Two devices take part. The **new** device makes its key and shows a short text; an **enrolled** device takes
the text, shows the person what it would add, and signs the add after the person agrees in a system dialog.

### How the text travels (open question 1)

The person copies it from one app to the other. A QR code needs a camera the desktop does not use, and a
request posted through the host would let any token holder (a session) post a fake one. The text is
`flightdeck-add:` followed by the base64url of the JSON `{"d": <daemon id>, "k": <public key>, "n": <name>}`.
It holds no secret: the public key and a name, which the host will list anyway. The enrolled device checks,
before it shows anything: the prefix, at most 1024 characters, the host's daemon id equals the one of the
host being edited (a text made for another host is refused), the public key is base64 of 91 bytes, the name
is 1 to 64 characters without control characters, and the key is not already listed.

### What the person compares

The name is not signed (`enrollAddMessage` covers the signer, the host, the nonce and the new public key),
so the name is a label and the **fingerprint** is the check. A fingerprint is the first 16 hex characters of
the key id (the SHA-256 of the public key's DER), in groups of four: `3f2a-91bc-07de-44a1`. The new device
shows its own, the enrolled device's panel shows the fingerprint it computed from the text, and the system
dialog shows it again, built in the shell from the text being signed, so a script in the webview cannot make
the dialog name another key than the one signed. Sixteen characters, not the eight the device list
abbreviates, because an attacker who swaps the key must find a key with the same prefix: 2^32 tries is
cheap, 2^64 is not.

### The shell

`approval_sign` gains one more thing it signs: `flightdeck/enroll-add/v1`, in the shell crate `describe`.
It refuses what the key must never sign: a text for another host (the daemon id of the command), a text whose
signer is not this device's key, and an add of this device's own key (that would be an enrollment, not an
add). The dialog says: "Add the device with key `3f2a-91bc-07de-44a1` as an approver of this host? Continue
only if the same code is on the other device." The dialog's words come from the parsed message and the
webview's language, never from text the webview sends. One dialog at a time stays.

### The new device's key

The new device uses the same `approval_key_create` as the first enrollment: one key per host, refused when
one exists. It keeps the key while it waits. The host's list not holding the key yet is the "waiting" state;
the host's `approval.enrolled` announcement (its own key is not told as a notice) refreshes the panel. The
person can cancel, which removes the key (`approval_key_delete`), or make a new text.

### The limit

A script in the webview of the enrolled device can ask for an add-signing dialog the person may accept by
habit; the dialog is the only control, as for an allow (#3439: "a reduction, not a proof"). An add is worse
than one allow because the new key then approves without the person, which is why the dialog names the key
and the add is its own signing purpose with its own text. A person who never opens the panel never sees the
dialog; a dialog the person did not start is the signal to cancel it.

## Not decided here

- Adding a key from the host terminal without a signer (a second window): it widens what a session at the
  host can do, and the reset path covers the lost-device case. Not built.
- Moving a private key between devices: never.
