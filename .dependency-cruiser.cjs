/**
 * The domain borders of the code (issue #1591, part of #1589), checked by dependency-cruiser:
 * `bun run arch`. Today's violations are in .dependency-cruiser-known-violations.json, a baseline
 * that only goes down (scripts/arch-ratchet.ts compares its counts with main). The domains are the
 * folders of the context map (docs/decisions/2026-11-10-context-map.md). The swc parser: the repo
 * is on TypeScript 7, which dependency-cruiser's own TypeScript parser does not support.
 */
const DAEMON = "^apps/daemon/src/";
const PROTOCOL = "^packages/protocol/src/";

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
        "shared/ is the most stable code: it imports no domain (SDP). Two domain-free leaves of the desktop stay where they are and shared/ may import them: components/ui (vendored shadcn, aliased by components.json) and lib/utils.ts (`cn`, which those ui files import); moving them is churn (#1597). Three more edges are allowed because the feedback primitives need them: the translation context (i18n/context.tsx, domain-free), the in-flight hook (hooks/use-in-flight.ts) and, until it moves into shared/layout, components/layout/form.tsx (the field-row context of the action button; form.tsx imports the feedback entry back, so move the context into a leaf file with the layout folder).",
      severity: "error",
      from: { path: "^apps/[^/]+/src/shared/" },
      to: {
        path: "^apps/[^/]+/src/",
        pathNot: [
          "^apps/[^/]+/src/shared/",
          "^apps/desktop/src/components/ui/",
          "^apps/desktop/src/lib/utils\\.ts$",
          "^apps/desktop/src/i18n/context\\.tsx$",
          "^apps/desktop/src/hooks/use-in-flight\\.ts$",
          "^apps/desktop/src/components/layout/form\\.tsx$",
        ],
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
