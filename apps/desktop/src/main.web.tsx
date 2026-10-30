// Web entry point (the demo and its prints): the browser platform, already paired with the demo's
// hosts; all logic lives in demo/boot.ts and is covered there.
import { createRoot } from "react-dom/client";
import {
  applyDemoPrefs,
  demoStoreOptions,
  initialRoute,
  parseDemoHosts,
  seedDemoHosts,
} from "./demo/boot.ts";
import { AppStore } from "./lib/app-store.ts";
import { createWebPlatform } from "./platform/web/index.ts";
import { App } from "./ui/App.tsx";
import "./styles.css";

const secrets = new Map<string, string>();
const demoHosts = parseDemoHosts(import.meta.env.VITE_DEMO_HOSTS);
seedDemoHosts(window.localStorage, secrets, demoHosts);
applyDemoPrefs(window.localStorage, window.location.search);
const store = new AppStore(createWebPlatform(undefined, secrets), demoStoreOptions(demoHosts));
const route = initialRoute(window.location.search);
if (route) store.router.push(route);

createRoot(document.getElementById("root") as HTMLElement).render(<App store={store} />);
