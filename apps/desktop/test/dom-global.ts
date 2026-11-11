import { GlobalRegistrator } from "@happy-dom/global-registrator";

/** Bun's networking primitives, which the in-process daemons use and happy-dom must not replace. */
const KEEP = [
  "WebSocket",
  "fetch",
  "Request",
  "Response",
  "Headers",
  "AbortController",
  "AbortSignal",
  "Blob",
  "File",
  "FormData",
  "URL",
  "TransformStream",
  "WritableStream",
] as const;

/** Registers happy-dom once per process; Bun's networking globals stay Bun's (the daemon tests need them). */
export function ensureHappyDom(): void {
  if (GlobalRegistrator.isRegistered) return;
  const g = globalThis as Record<string, unknown>;
  const keep = Object.fromEntries(KEEP.map((name) => [name, g[name]]));
  GlobalRegistrator.register();
  Object.assign(globalThis, keep);
}
