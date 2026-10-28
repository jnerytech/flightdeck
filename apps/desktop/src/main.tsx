// Browser entry point: wires the Tauri platform into the app; all logic is covered elsewhere.
import { createRoot } from "react-dom/client";
import { AppStore } from "./lib/app-store.ts";
import { tauriPlatform } from "./platform/tauri/index.ts";
import { App } from "./ui/App.tsx";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <App store={new AppStore(tauriPlatform())} />,
);
