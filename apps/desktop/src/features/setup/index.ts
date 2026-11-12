/** The first-day setup screen, public entry (#1589): another domain imports from here, never a file inside. The screen itself (`page.tsx`) is loaded by the app's screens, not exported here, so the store can import the steps without a cycle. */
export { SetupProbes } from "./probes.ts";
export {
  missingTools,
  probeAfter,
  type SetupProbe,
  SetupSettings,
  setupProgress,
  setupSteps,
} from "./setup-steps.ts";
