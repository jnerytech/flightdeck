/**
 * #3439: the approval domain: the devices that sign a high-risk allow. A device asks for a challenge,
 * enrolls its key and revokes one here; the host terminal alone opens the window of the first key.
 */
import type { Handlers } from "../domain/handler.ts";

export const approvalHandlers = {
  "approval.challenge": () => ({ nonce: "", daemonId: "", expiresInMs: 0 }),
  "approval.enroll": () => ({ keyId: "", daemonId: "" }),
  "approval.revoke": () => ({ keyId: "" }),
  "approval.list": () => ({ daemonId: "", protectionOff: false, keys: [] }),
} satisfies Partial<Handlers>;
