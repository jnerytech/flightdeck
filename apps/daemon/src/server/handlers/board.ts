/**
 * Issue #248, #1288: the board domain: a project's board, its settings and its live card updates.
 */
import type { Handlers } from "../dispatch.ts";

export const boardHandlers = {
  "board.get": async (payload, { server }) => {
    const board = server.need("board");
    const found = board.getBoard(payload.projectId);
    return { ...found, project: await board.forWire(found.project) };
  },
  "board.settings": async (payload, { server }) => {
    const board = server.need("board");
    const { maxParallelRuns } = payload;
    if (maxParallelRuns !== undefined) await board.setMaxParallelRuns(maxParallelRuns);
    return { maxParallelRuns: board.maxParallelRuns };
  },
  "board.watch": (_payload, { ws, send, server }) => {
    const board = server.need("board");
    ws.data.unwatchBoard?.();
    ws.data.unwatchBoard = board.watch((card) => send({ type: "card.updated", card }));
  },
} satisfies Partial<Handlers>;
