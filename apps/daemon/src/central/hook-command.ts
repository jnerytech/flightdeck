import {
  forwardSessionStart,
  type PostSessionStart,
  type SessionStartOptions,
} from "./domain/hook-command.ts";

/** The real sender of `flightdeckd hook session-start`: a fetch that gives up after the timeout. */
const post: PostSessionStart = (url, request) =>
  fetch(url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(request.timeoutMs),
  }).then(() => {});

export const sendSessionStart = (opts: SessionStartOptions): Promise<void> =>
  forwardSessionStart(opts, post);
