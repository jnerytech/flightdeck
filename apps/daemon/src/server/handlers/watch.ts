/**
 * Issue #1288: the watch domain: a card's pull request watched and fixed (phase 22).
 */
import { requireVaultTransport } from "../../vault/vault.ts";
import type { Handlers } from "../dispatch.ts";

/**
 * Issue #1361: the fields that decide what runs unattended in a card's worktree, as whom
 * (`persona`), and what a round may push outside its PR (`driftAllow`). A patch that changes one
 * needs a near connection; one that sends them unchanged (the whole form) does not.
 */
const NEAR_ONLY = [
  "checks",
  "checkTimeoutMin",
  "checkRounds",
  "checkEnv",
  "checkLoopDefault",
  "persona",
  "driftAllow",
] as const;

export const watchHandlers = {
  "watch.settings": (payload, { ws, server }) => {
    const watch = server.need("watch");
    const { projectId, patch } = payload;
    if (patch) {
      const current = watch.settings(projectId);
      const changed = NEAR_ONLY.filter(
        (key) => key in patch && JSON.stringify(patch[key]) !== JSON.stringify(current[key]),
      );
      if (changed.length > 0) {
        requireVaultTransport(ws.data.origin, "watch.settings", server.opts.log);
        // The project's trail of who changed what runs unattended: the fields, not their values.
        server.opts.log?.(`watch.settings: project ${projectId} changed ${changed.join(", ")}`);
      }
    }
    return watch.settings(projectId, patch);
  },
  "watch.set": (payload, { server }) => {
    return server.need("watch").set(payload.cardId, payload.enabled);
  },
  "watch.get": (payload, { server }) => {
    return server.need("watch").info(payload.cardId);
  },
  "watch.resolveHeld": async (payload, { server }) => {
    const { cardId, roundId, action } = payload;
    return await server.need("watch").resolveHeld(cardId, roundId, action);
  },
  "watch.extend": (payload, { server }) => {
    return server.need("watch").extend(payload.cardId, payload.rounds);
  },
  "watch.trace": (payload, { server }) => {
    return server.need("watch").trace(payload.cardId);
  },
  "watch.describe": (payload, { server }) => {
    return server.need("watch").describe(payload.cardId);
  },
  "watch.byUrl": (payload, { server }) => {
    return server.need("watch").byUrl(payload.url);
  },
  "watch.watch": (_payload, { ws, send, server }) => {
    const service = server.need("watch");
    ws.data.unwatchPrs?.();
    ws.data.unwatchPrs = service.watch((frame) => send(frame));
  },
} satisfies Partial<Handlers>;
