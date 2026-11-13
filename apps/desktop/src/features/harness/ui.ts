/**
 * The harness' public entry in the app (#1589, #1597): the project's harness panel and the host's
 * list of shared harness templates. Another domain imports from here, never a file inside. Only
 * components, so this is the components' entry (ui.ts, #2451) and there is no index.ts.
 */
export { HarnessPanel } from "./harness-panel.tsx";
export { HarnessTemplatesSection } from "./templates-section.tsx";
