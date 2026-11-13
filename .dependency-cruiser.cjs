/**
 * The domain borders of the code (issue #1591, part of #1589), checked by dependency-cruiser:
 * `bun run arch`. Today's violations are in .dependency-cruiser-known-violations.json, a baseline
 * that only goes down (scripts/arch-ratchet.ts compares its counts with main). The domains are the
 * folders of the context map (docs/decisions/2026-11-10-context-map.md). The swc parser: the repo
 * is on TypeScript 7, which dependency-cruiser's own TypeScript parser does not support. The
 * desktop's import cycles have no rule here: the known-violations entries are keyed by path and by
 * cycle, so every move or barrel read as a new one. `bun run arch` counts the files that sit in a
 * cycle instead (scripts/lib/arch/cycle-files.ts, desktop-cycles-baseline.json) (#1624).
 */
const DAEMON = "^apps/daemon/src/";
const PROTOCOL = "^packages/protocol/src/";
const DESKTOP = "^apps/desktop/src/";

module.exports = {
  forbidden: [
    {
      name: "no-cycle",
      comment: "No import cycle: a cycle makes two modules change together (ADP).",
      severity: "error",
      from: { path: `${DAEMON}|${PROTOCOL}` },
      to: { circular: true },
    },
    {
      name: "no-deep-cross-domain",
      comment: "Another domain is reached through its public entry (index.ts) only.",
      severity: "error",
      from: { path: `${DAEMON}([^/]+)/` },
      to: { path: `${DAEMON}([^/]+)/(?!index\\.ts$)`, pathNot: `${DAEMON}$1/` },
    },
    {
      name: "desktop-no-deep-cross-domain",
      comment:
        "A desktop feature reaches another feature through its public entry (index.ts) only (#1624, folder map: docs/decisions/2026-11-12-desktop-folder-map.md).",
      severity: "error",
      from: { path: `${DESKTOP}features/([^/]+)/` },
      to: {
        path: `${DESKTOP}features/([^/]+)/(?!index\\.ts$)`,
        pathNot: `${DESKTOP}features/$1/`,
      },
    },
    {
      name: "protocol-context-not-from-entry",
      comment:
        "A protocol context file never imports index.ts, which re-exports it: a load-time cycle breaks zod schemas (#1600).",
      severity: "error",
      from: { path: `${PROTOCOL}(?!index\\.ts$)` },
      to: { path: `${PROTOCOL}index\\.ts$` },
    },
    {
      name: "shared-depends-on-no-domain",
      comment:
        "shared/ is the most stable code: it imports no domain (SDP). Two domain-free leaves of the desktop stay where they are and shared/ may import them: components/ui (vendored shadcn, aliased by components.json) and lib/utils.ts (`cn`, which those ui files import); moving them is churn (#1597). More edges are allowed because the feedback and layout primitives need them: the translation context (i18n/context.tsx, domain-free); the in-flight hook now lives in shared/hooks/. The width and scroll helpers the layout primitives need now live in shared/lib/.",
      severity: "error",
      from: { path: "^apps/[^/]+/src/shared/" },
      to: {
        path: "^apps/[^/]+/src/",
        pathNot: [
          "^apps/[^/]+/src/shared/",
          "^apps/desktop/src/components/ui/",
          "^apps/desktop/src/lib/utils\\.ts$",
          "^apps/desktop/src/i18n/context\\.tsx$",
        ],
      },
    },
    {
      name: "domain-is-pure",
      comment:
        "A domain's rules (domain/) do no I/O: no SQLite, filesystem, process, WebSocket or Tauri module; time and I/O come in through a port (#1601). Bun.spawn, Bun.file and Date.now are globals, not imports: the domain-purity guard test checks those.",
      severity: "error",
      from: { path: "/domain/" },
      to: {
        path: "^(bun:sqlite|(node:)?(fs|fs/promises|child_process))$|(^|/node_modules/)(ws|@tauri-apps/[^/]+)(/|$)",
      },
    },
    {
      name: "domain-depends-on-no-adapter",
      comment: "A domain's rules (domain/) never import its I/O (adapters/): ports and adapters.",
      severity: "error",
      from: { path: "/domain/" },
      to: { path: "/adapters/" },
    },
  ],
  options: {
    parser: "swc",
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)node_modules/" },
    enhancedResolveOptions: { extensions: [".ts", ".tsx", ".js"] },
    // The desktop imports through the `@/` alias; without this its edges are never seen (#1597).
    tsConfig: { fileName: "apps/desktop/tsconfig.json" },
  },
};
