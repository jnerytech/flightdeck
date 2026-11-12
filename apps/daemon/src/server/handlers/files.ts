/**
 * Issue #1288: the files domain: the folders and files a host shows (the project picker, the
 * review's file tree, the editor and its search).
 */
import { listDirs, listFiles } from "../../files/index.ts";
import type { Handlers } from "../dispatch.ts";

export const filesHandlers = {
  "files.sessions": (payload, { server }) => {
    return { sessions: server.needIn("review", "sessionFiles").sessionsOf(payload.path) };
  },
  "fs.dirs": async (payload, { server }) => {
    const { path, hidden } = payload;
    return await listDirs(path, server.opts.allowedRoots, hidden === undefined ? {} : { hidden });
  },
  "fs.files": async (payload, { server }) => {
    const { path, hidden } = payload;
    return await listFiles(path, server.opts.allowedRoots, hidden === undefined ? {} : { hidden });
  },
  "file.list": async (payload, { server }) => {
    return await server.needIn("review", "files").list(payload.target, payload.dir);
  },
  "file.read": async (payload, { server }) => {
    return await server.needIn("review", "files").read(payload.target, payload.path);
  },
  "file.search": async (payload, { ws, server }) => {
    // One search at a time per connection: a newer one replaces the one before it (#905).
    ws.data.search?.abort();
    const mine = new AbortController();
    ws.data.search = mine;
    try {
      return await server.needIn("review", "files").search(payload, mine.signal);
    } finally {
      if (ws.data.search === mine) ws.data.search = undefined;
    }
  },
  "file.write": async (payload, { server }) => {
    const { target, path, text, expectedHash } = payload;
    return await server.needIn("review", "files").write(target, path, text, expectedHash);
  },
} satisfies Partial<Handlers>;
