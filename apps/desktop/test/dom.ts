// DOM for the UI tests, registered once per test process and never removed: tearing happy-dom
// down and up again between files left React event handling detached from the new document.
// Bun's networking globals are kept, and the daemon tests run unaffected next to it.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Keep Bun's networking primitives: the UI tests talk to a real in-process daemon. Daemon tests
// run in the same process after these files (Bun's file order differs between Linux and
// Windows), so what the daemon passes to Bun's fetch, streams and spawn stays Bun's too:
// happy-dom's AbortSignal, Blob or URL are not accepted there.
const keep = {
  WebSocket: globalThis.WebSocket,
  fetch: globalThis.fetch,
  Request: globalThis.Request,
  Response: globalThis.Response,
  Headers: globalThis.Headers,
  AbortController: globalThis.AbortController,
  AbortSignal: globalThis.AbortSignal,
  Blob: globalThis.Blob,
  File: globalThis.File,
  FormData: globalThis.FormData,
  URL: globalThis.URL,
  TransformStream: globalThis.TransformStream,
  WritableStream: globalThis.WritableStream,
};

export function registerDom(): void {
  if (GlobalRegistrator.isRegistered) return;
  GlobalRegistrator.register();
  Object.assign(globalThis, keep);
}

/**
 * Testing Library's `screen` is bound to the `document.body` that existed when it was first
 * imported; with one DOM per test file that body goes stale. This one always queries the
 * current document.
 */
export function liveScreen<T extends object>(within: (element: HTMLElement) => T): T {
  return new Proxy({} as T, {
    get: (_target, key) => (within(document.body) as Record<PropertyKey, unknown>)[key],
  });
}
