/**
 * Issue #248, #1288: the card domain: create, update, move, start and stop a card, its arena,
 * its pull request, and its merge, completion and removal. The board itself (`board.*`) and the
 * pull request comments are separate.
 */
import { manageCard } from "../../board/manage.ts";
import { requireVaultTransport } from "../../vault/vault.ts";
import type { Handlers } from "../dispatch.ts";

export const cardHandlers = {
  "card.startArena": async (payload, { server }) => {
    const { cardId, ...input } = payload;
    return await server.need("board").startArena(cardId, input);
  },
  "card.arena": async (payload, { server }) => {
    return await server.need("board").arena(payload.cardId);
  },
  "card.chooseVariant": async (payload, { server }) => {
    const { cardId, variantId, confirm } = payload;
    return await server.need("board").chooseVariant(cardId, variantId, confirm === true);
  },
  "card.create": async (payload, { server }) => {
    const { projectId, ...input } = payload;
    return await server.need("board").createCardFrom(projectId, input);
  },
  "card.templates": async (payload, { server }) => {
    return await server.need("board").cardTemplates(payload.projectId);
  },
  "card.update": async (payload, { server }) => {
    const { cardId, ...patch } = payload;
    const board = server.need("board");
    const updated = board.updateCard(cardId, patch);
    // A new spec path is looked at at once, so the card says what was found there.
    return patch.specPath === undefined ? updated : await board.refreshSpec(cardId);
  },
  // Issue #1361: the loop lets the checks run the card's code unasked, so turning it on (with or
  // without a confirmation: the mode can change right after) needs a near connection; turning it
  // off works from anywhere.
  "card.checkLoop": (payload, { ws, server }) => {
    const { cardId, on, confirm, rounds } = payload;
    if (on) requireVaultTransport(ws.data.origin, "card.checkLoop", server.opts.log);
    return server.need("checkLoop").set(cardId, {
      on,
      ...(confirm === undefined ? {} : { confirm }),
      ...(rounds === undefined ? {} : { rounds }),
    });
  },
  "card.dismissUnblocked": (payload, { server }) => {
    return server.need("board").dismissUnblocked(payload.cardId);
  },
  "card.move": async (payload, { server }) => {
    const { cardId, column, position, force } = payload;
    return await server.need("board").moveByHand(cardId, column, position, force === true);
  },
  "card.get": (payload, { server }) => {
    return server.need("board").getCard(payload.cardId);
  },
  "card.review": async (_payload, _call) => {
    return {
      state: "failed" as const,
      summary: "",
      anchored: 0,
      loose: [],
      cached: false,
      moved: false,
    };
  },
  "card.spec": async (payload, { server }) => {
    return await server.need("board").refreshSpec(payload.cardId);
  },
  "card.validationTemplate": async (payload, { server }) => {
    return await server.need("board").validationTemplate(payload.cardId);
  },
  "card.updateFromBase": async (payload, { server }) => {
    return await server.need("board").updateFromBase(payload.cardId);
  },
  "card.mergeLocal": async (payload, { server }) => {
    const { cardId, mode, confirm, message } = payload;
    return await server.need("board").mergeLocal(cardId, mode, confirm === true, message);
  },
  "card.start": async (payload, { server }) => {
    const { cardId, workflow, inputs, persona } = payload;
    return await server.need("board").startCard(cardId, { workflow, inputs, persona });
  },
  "card.stop": async (payload, { server }) => {
    return await server.need("board").stopCard(payload.cardId);
  },
  "card.diff": async (payload, { server }) => {
    return await server.need("board").diff(payload.cardId);
  },
  "card.message": (payload, { server }) => {
    return server.need("board").message(payload.cardId, payload.text);
  },
  "card.pr.create": async (payload, { server }) => {
    return await server.need("board").createPr(payload.cardId, {
      ...(payload.description === undefined ? {} : { description: payload.description }),
      ...(payload.title === undefined ? {} : { title: payload.title }),
    });
  },
  "card.manage": async (payload, { server }) => {
    return await manageCard(
      {
        board: server.need("board"),
        cwdOf: (sessionId) => {
          try {
            return server.manager.get(sessionId).cwd;
          } catch {
            return null;
          }
        },
      },
      payload,
    );
  },
  "card.pr.merge": async (payload, { ws, server }) => {
    // It merges on the provider with this computer's gh login: a near connection only.
    requireVaultTransport(ws.data.origin, "card.pr.merge", server.opts.log);
    const { cardId, method, confirm } = payload;
    return await server.need("board").mergePr(cardId, method, confirm === true);
  },
  "card.complete": async (payload, { server }) => {
    const { cardId, confirm } = payload;
    return await server.need("board").completeCard(cardId, confirm === true);
  },
  "card.delete": (payload, { server }) => {
    const { cardId, confirm } = payload;
    return server.need("board").deleteCard(cardId, confirm === true);
  },
  "card.discard": async (payload, { server }) => {
    const { cardId, confirm } = payload;
    return await server.need("board").discardCard(cardId, confirm === true);
  },
} satisfies Partial<Handlers>;
