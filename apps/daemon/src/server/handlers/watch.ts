/**
 * Issue #1288: the watch domain: a card's pull request watched and fixed (phase 22).
 */
import type { Handlers } from "../dispatch.ts";

export const watchHandlers = {
  "watch.settings": (payload, { server }) => {
    return server.need("watch").settings(payload.projectId, payload.patch);
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
