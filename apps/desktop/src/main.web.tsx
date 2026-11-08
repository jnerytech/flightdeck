// Web entry point (the demo and its prints): the browser platform, already paired with the demo's
// hosts; all logic lives in demo/boot.ts and is covered there.
import { createRoot } from "react-dom/client";
import {
  applyDemoPrefs,
  demoPlatform,
  demoStoreOptions,
  demoToast,
  initialRoute,
  parseDemoHosts,
  seedDemoHosts,
} from "./demo/boot.ts";
import { reactRootErrorHandlers } from "./lib/app-log.ts";
import { AppStore } from "./lib/app-store.ts";
import { createWebPlatform } from "./platform/web/index.ts";
import { App } from "./ui/App.tsx";
import "./styles.css";

const secrets = new Map<string, string>();
const demoHosts = parseDemoHosts(import.meta.env.VITE_DEMO_HOSTS, window.location.search);
seedDemoHosts(window.localStorage, secrets, demoHosts);
applyDemoPrefs(window.localStorage, window.location.search);
const store = new AppStore(
  demoPlatform(createWebPlatform(undefined, secrets), window.location.search),
  demoStoreOptions(demoHosts, window.location.search),
);
const route = initialRoute(window.location.search);
if (route) store.router.push(route);
demoToast(store, window);

createRoot(
  document.getElementById("root") as HTMLElement,
  reactRootErrorHandlers(store.appLog, () => store.router.current.name),
).render(<App store={store} />);
