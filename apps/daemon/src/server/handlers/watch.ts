/**
 * Issue #1288: the watch domain: a card's pull request watched and fixed (phase 22).
 */
import { requireVaultTransport } from "../../vault/vault.ts";
import type { Handlers } from "../dispatch.ts";

/**
 * Issue #1361: the fields a far client may change: the switch and the brakes on spending (rounds,
 * turns, failures, money). Every other field decides what runs unattended in a card's worktree, as
 * whom, or what a round may push, so a patch that changes it needs a near connection; one that
 * sends it unchanged (the whole form) does not. A new field is near-only until it is named here.
 */
const FAR_EDITABLE: ReadonlySet<string> = new Set([
  "enabled",
  "maxRounds",
  "maxTurns",
  "maxFailures",
  "budgetUsd",
  "dailyUsd",
]);

export const watchHandlers = {
  "watch.settings": (payload, { ws, server }) => {
    const watch = server.needIn("prWatch", "watch");
    const { projectId, patch } = payload;
    if (patch) {
      const current: Record<string, unknown> = { ...watch.settings(projectId) };
      const changed = Object.entries(patch)
        .filter(([key]) => !FAR_EDITABLE.has(key))
        .filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(current[key]))
        .map(([key]) => key);
      if (changed.length > 0) {
        requireVaultTransport(ws.data.origin, "watch.settings", server.opts.log);
        // The project's trail of who changed what runs unattended: the fields, not their values.
        server.opts.log?.(`watch.settings: project ${projectId} changed ${changed.join(", ")}`);
      }
    }
    return watch.settings(projectId, patch);
  },
  "watch.set": (payload, { server }) => {
    return server.needIn("prWatch", "watch").set(payload.cardId, payload.enabled);
  },
  "watch.get": (payload, { server }) => {
    return server.needIn("prWatch", "watch").info(payload.cardId);
  },
  "watch.resolveHeld": async (payload, { server }) => {
    const { cardId, roundId, action } = payload;
    return await server.needIn("prWatch", "watch").resolveHeld(cardId, roundId, action);
  },
  "watch.extend": (payload, { server }) => {
    return server.needIn("prWatch", "watch").extend(payload.cardId, payload.rounds);
  },
  "watch.trace": (payload, { server }) => {
    return server.needIn("prWatch", "watch").trace(payload.cardId);
  },
  "watch.describe": (payload, { server }) => {
    return server.needIn("prWatch", "watch").describe(payload.cardId);
  },
  "watch.byUrl": (payload, { server }) => {
    return server.needIn("prWatch", "watch").byUrl(payload.url);
  },
  "watch.watch": (_payload, { ws, send, server }) => {
    const service = server.needIn("prWatch", "watch");
    ws.data.unwatchPrs?.();
    ws.data.unwatchPrs = service.watch((frame) => send(frame));
  },
} satisfies Partial<Handlers>;
