// Browser entry point: wires the Tauri platform into the app; all logic is covered elsewhere.
import { createRoot } from "react-dom/client";
import { installGlobalLog } from "./lib/app-log.ts";
import { AppStore } from "./lib/app-store.ts";
import { tauriPlatform } from "./platform/tauri/index.ts";
import { App } from "./ui/App.tsx";
import "./styles.css";

const store = new AppStore(tauriPlatform());
// The webview's own errors, rejections and console errors go to the app's log file.
installGlobalLog(
  {
    addEventListener: (type, listener) => window.addEventListener(type, listener as EventListener),
    removeEventListener: (type, listener) =>
      window.removeEventListener(type, listener as EventListener),
  },
  store.appLog,
);

createRoot(document.getElementById("root") as HTMLElement).render(<App store={store} />);
