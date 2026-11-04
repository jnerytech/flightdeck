// DOM for the UI tests, registered once per test process and never removed: tearing happy-dom
// down and up again between files left React event handling detached from the new document.
// Bun's networking globals are kept, and the daemon tests run unaffected next to it.

import { afterAll } from "bun:test";
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

type Members = Record<PropertyKey, PropertyDescriptor>;

/** The own members of every DOM class's prototype, as they are now. */
function snapshotPrototypes(): Map<object, Members> {
  const snapshot = new Map<object, Members>();
  // happy-dom's EventTarget, the root of its classes: the global one is Bun's, kept for the daemon.
  const root = Object.getPrototypeOf(Node.prototype) as object;
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    let value: unknown;
    try {
      value = (globalThis as Record<string, unknown>)[name];
    } catch {
      continue;
    }
    if (typeof value !== "function" || !/^[A-Z]/.test(name)) continue;
    const proto = (value as { prototype?: object }).prototype;
    if (!proto || snapshot.has(proto)) continue;
    // DOM classes only: Bun's and the language's own classes are not ours to restore.
    if (proto !== root && !root.isPrototypeOf(proto)) continue;
    snapshot.set(proto, Object.getOwnPropertyDescriptors(proto) as Members);
  }
  return snapshot;
}

/** Puts every prototype back as it was: members added are deleted, members replaced are restored. */
function restorePrototypes(snapshot: Map<object, Members>): void {
  for (const [proto, before] of snapshot) {
    const now = Object.getOwnPropertyDescriptors(proto) as Members;
    for (const key of Reflect.ownKeys(now)) {
      if (!(key in before)) Reflect.deleteProperty(proto, key);
    }
    for (const key of Reflect.ownKeys(before)) {
      const was = before[key] as PropertyDescriptor;
      const is = now[key];
      if (!is || is.value !== was.value || is.get !== was.get || is.set !== was.set) {
        Object.defineProperty(proto, key, was);
      }
    }
  }
}

/**
 * Registers the DOM once per process, and for each file that calls it, puts the DOM prototypes back
 * after the file: a test that patches `HTMLElement.prototype.scrollIntoView` and never restores it
 * would otherwise leak into the files that run after it.
 */
export function registerDom(): void {
  if (GlobalRegistrator.isRegistered) {
    // Every test file calls this first. The DOM stays for the whole process, so what a file left in
    // the browser storage (a view choice, a stored window) must not reach the next one, whatever
    // order the files run in on the platform.
    globalThis.localStorage?.clear();
    globalThis.sessionStorage?.clear();
  } else {
    GlobalRegistrator.register();
    Object.assign(globalThis, keep);
  }
  const snapshot = snapshotPrototypes();
  afterAll(() => restorePrototypes(snapshot));
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

// Lazy screens load their chunk when a route opens; a test that clicks into one and asserts at
// once would race that load (and pass or fail by file order, whichever test cached it first).
// Every UI test file imports this module, so the screens are loaded here, once, before any test.
registerDom();
const { preloadAllScreens } = await import("../src/ui/lazy-screen.ts");
await import("../src/ui/Screens.tsx");
await preloadAllScreens();
