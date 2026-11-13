/**
 * The library's public entry in the app (#1589, #1597): a project's document library panel.
 * Another domain imports from here, never a file inside. Only components, so this is the
 * components' entry (ui.ts, #2451) and there is no index.ts.
 */
export { KnowledgePanel } from "./knowledge-panel.tsx";
