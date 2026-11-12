import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { staticImports } from "../../lib/bundle/bundle-reach.ts";

const UI = resolve(import.meta.dir, "../../../apps/desktop/src/ui");

/**
 * The screens the entry chunk does not need to open the first one: each is loaded with
 * `import()` when its route is opened (`bundle:budget` keeps the entry under its limit).
 */
const LAZY_SCREENS = [
  "ActionsPage",
  "AgentPage",
  "AutoApprovalsPage",
  "AutomationsPage",
  "BoardView",
  "CardDetail",
  "ClientsPage",
  "ConnectionsPage",
  "ConversationsPage",
  "CostsPage",
  "HostPage",
  "PersonasPage",
  "PluginsPage",
  "PreviewPage",
  "ProjectsPage",
  "SnippetsPage",
  "TeamsPage",
  "VaultPage",
  "WorkflowsPage",
  "Settings",
];

/**
 * Where Screens.tsx loads a lazy screen from (#1597): a screen that moved into its feature folder
 * is `features/<name without "Page", lowercased>/page.tsx`, or in the plural folder (`HostPage` is
 * in `features/hosts`); a screen that is a file of its domain, not its `page.tsx`, is named in
 * `FILE_OF`; the rest are still `ui/<name>.tsx`. Looking at the disk means a move into a
 * `page.tsx` does not edit this test.
 */
const FEATURES = resolve(UI, "../features");
/** A screen whose domain folder is not its name (GLOSSARY Domains): the Agent screen is agentcfg, Conversations is messaging, Connections is ssh, the auto-approvals screen is permissions, the Preview screen is runenv. */
const DOMAIN_OF: Record<string, string> = {
  AgentPage: "agentcfg",
  ConversationsPage: "messaging",
  ConnectionsPage: "ssh",
  AutoApprovalsPage: "permissions",
  PreviewPage: "runenv",
};

/** A screen that is a file of its domain, not the domain's `page.tsx`: a card's detail and the board itself are board files. */
const FILE_OF: Record<string, string> = {
  BoardView: "board/board-view.tsx",
  CardDetail: "board/card-detail.tsx",
};

const specifierOf = (name: string) => {
  const file = FILE_OF[name];
  if (file) return `../features/${file}`;
  const feature = name.replace(/Page$/, "").toLowerCase();
  const folder = [DOMAIN_OF[name] ?? feature, feature, `${feature}s`].find((dir) =>
    existsSync(resolve(FEATURES, dir, "page.tsx")),
  );
  return folder ? `../features/${folder}/page.tsx` : `./${name}.tsx`;
};

describe("screens-lazy: the secondary screens are not in the entry chunk", () => {
  const read = (file: string) => readFileSync(resolve(UI, file), "utf8");
  const SRC = resolve(UI, "..");
  // A specifier as the absolute file it names, whether it is written with `@/` or relative.
  const target = (from: string, specifier: string) =>
    specifier.startsWith("@/")
      ? resolve(SRC, specifier.slice(2))
      : resolve(dirname(from), specifier);

  test("no file the entry loads imports a lazy screen statically", () => {
    const loaders = ["Screens.tsx", "App.tsx", "../features/shell/sidebar.tsx"].map((file) =>
      resolve(UI, file),
    );
    const lazyFiles = LAZY_SCREENS.map((name) => resolve(UI, specifierOf(name)));
    const eager = loaders.flatMap((file) =>
      staticImports(readFileSync(file, "utf8"))
        .filter((specifier) => lazyFiles.includes(target(file, specifier)))
        .map((specifier) => `${file}: ${specifier}`),
    );
    expect(eager).toEqual([]);
  });

  test("Screens.tsx loads each of them with import() inside React.lazy", () => {
    const source = read("Screens.tsx");
    for (const name of LAZY_SCREENS) {
      expect(source).toContain(`import("${specifierOf(name)}")`);
    }
    expect(source).toContain("<Suspense");
  });
});
