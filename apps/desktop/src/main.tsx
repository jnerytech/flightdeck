// Browser entry point: wires the Tauri platform into the app; all logic is covered elsewhere.
import { createRoot } from "react-dom/client";
import { installGlobalLog, reactRootErrorHandlers } from "./lib/app-log.ts";
import { AppStore } from "./lib/app-store.ts";
import { holdAwake } from "./lib/keep-awake.ts";
import { tauriPlatform } from "./platform/tauri/index.ts";
import { App } from "./ui/App.tsx";
import "./styles.css";

const store = new AppStore(tauriPlatform(), { startRoute: { name: "overview" } });
// The webview's own errors, rejections and console errors go to the app's log file.
installGlobalLog(
  {
    addEventListener: (type, listener) => window.addEventListener(type, listener as EventListener),
    removeEventListener: (type, listener) =>
      window.removeEventListener(type, listener as EventListener),
  },
  store.appLog,
  console,
  // Only the route's name is logged with a React error: where the person was, nothing they typed.
  () => store.router.current.name,
);

// A minimized window's page is not frozen while it holds a lock: the hosts' heartbeats go on (#939).
holdAwake(navigator.locks, (error) =>
  store.appLog.log("warn", "app", `keep-awake lock refused: ${String(error)}`),
);

createRoot(
  document.getElementById("root") as HTMLElement,
  reactRootErrorHandlers(store.appLog, () => store.router.current.name),
).render(<App store={store} />);
