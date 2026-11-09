/**
 * Issue #1288: the PR comments domain: a card's PR review comments, and sending them to its session.
 */
import type { Handlers } from "../dispatch.ts";

export const prCommentsHandlers = {
  "pr.comments": async (payload, { server }) => {
    return { comments: await server.need("board").prComments(payload.cardId) };
  },
  "pr.comments.send": async (payload, { server }) => {
    const { cardId, ids } = payload;
    return await server.need("board").sendPrComments(cardId, ids);
  },
} satisfies Partial<Handlers>;
