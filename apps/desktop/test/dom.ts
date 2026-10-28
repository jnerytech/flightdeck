// Must be imported before @testing-library/react: `screen` binds to document.body on import.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Keep Bun's networking primitives: the UI tests talk to a real in-process daemon.
const keep = {
  WebSocket: globalThis.WebSocket,
  fetch: globalThis.fetch,
  Request: globalThis.Request,
  Response: globalThis.Response,
  Headers: globalThis.Headers,
};
GlobalRegistrator.register();
Object.assign(globalThis, keep);

export const unregisterDom = () => GlobalRegistrator.unregister();
