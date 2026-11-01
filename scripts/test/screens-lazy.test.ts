import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { staticImports } from "../lib/bundle-reach.ts";

const UI = resolve(import.meta.dir, "../../apps/desktop/src/ui");

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

describe("screens-lazy: the secondary screens are not in the entry chunk", () => {
  const read = (file: string) => readFileSync(resolve(UI, file), "utf8");

  test("no file the entry loads imports a lazy screen statically", () => {
    const loaders = ["Screens.tsx", "App.tsx", "Sidebar.tsx"];
    const eager = loaders.flatMap((file) =>
      staticImports(read(file))
        .filter((specifier) => LAZY_SCREENS.some((name) => specifier === `./${name}.tsx`))
        .map((specifier) => `${file}: ${specifier}`),
    );
    expect(eager).toEqual([]);
  });

  test("Screens.tsx loads each of them with import() inside React.lazy", () => {
    const source = read("Screens.tsx");
    for (const name of LAZY_SCREENS) {
      expect(source).toContain(`import("./${name}.tsx")`);
    }
    expect(source).toContain("<Suspense");
  });
});
