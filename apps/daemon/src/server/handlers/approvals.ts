/**
 * #3439: the approval domain: the devices that sign a high-risk allow. A device asks for a challenge,
 * enrolls its key and revokes one here; the host terminal alone opens the window of the first key
 * (`flightdeckd approvers enroll`), so nothing in this file writes the window or resets the keys.
 */
import { FlightdeckError } from "../../kernel/index.ts";
import type { Handlers } from "../domain/handler.ts";

export const approvalHandlers = {
  "approval.challenge": (payload, { ws, server }) => {
    const approvers = server.need("approvers");
    if (payload.purpose !== "approve")
      return approvers.challenge(payload.purpose, undefined, ws.data.id);
    // A nonce for an allow is made only for a request that is open, managed or external.
    const { requestId } = payload;
    const open =
      server.opts.central?.permissions.placeOf(requestId) !== undefined ||
      Boolean(server.manager.sessionOfRequest(requestId));
    if (!open) {
      throw new FlightdeckError(
        "not_found",
        `permission request ${requestId} is not open`,
        "permission_request_closed",
        { id: requestId },
      );
    }
    return approvers.challenge("approve", requestId, ws.data.id);
  },
  "approval.enroll": (payload, { ws, server }) => {
    return server.need("approvers").enroll(payload, {
      connection: ws.data.id,
      address: ws.data.origin,
      client: ws.data.client ?? "",
    });
  },
  "approval.revoke": (payload, { server }) => {
    return server.need("approvers").revoke(payload);
  },
  "approval.list": (_payload, { server }) => {
    return server.need("approvers").list();
  },
  "approval.watch": (_payload, { ws, send, server }) => {
    const approvers = server.need("approvers");
    ws.data.unwatchApprovals?.();
    ws.data.unwatchApprovals = approvers.onChange((change) => send(change));
  },
} satisfies Partial<Handlers>;
