import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkDomains,
  DOMAIN_ROOTS,
  domainFolders,
  glossaryDomains,
  LAYER_FOLDERS,
} from "../../lib/guards/domain-glossary.ts";

const ROOT = join(import.meta.dir, "../../..");

const GLOSSARY = `# Glossary

| Português | English | Quando |
| --- | --- | --- |
| \`fake\` | fake | a UI term row, not a domain |

## Domains

| Folder | Domain | What it owns |
| --- | --- | --- |
| \`board\` | board | the cards |
| \`sessions\` | session | the sessions |

## After

| \`later\` | later | a table after the section |
`;

describe("domain-glossary", () => {
  test("the domains are the backticked first column of the Domains section only", () => {
    expect(glossaryDomains(GLOSSARY)).toEqual(new Set(["board", "sessions"]));
  });

  test("a folder with no entry is missing; a baseline name is not", () => {
    const folders = ["apps/daemon/src/board", "apps/daemon/src/server", "apps/daemon/src/vault"];
    expect(checkDomains(folders, new Set(["board"]), ["server"])).toEqual({
      missing: ["apps/daemon/src/vault"],
      stale: [],
    });
  });

  test("the same domain in two apps needs one entry", () => {
    const folders = [
      "apps/daemon/src/board",
      "apps/desktop/src/features/board",
      "apps/desktop/src/features/vault",
    ];
    expect(checkDomains(folders, new Set(["board"]), [])).toEqual({
      missing: ["apps/desktop/src/features/vault"],
      stale: [],
    });
  });

  test("a baseline name that is gone, or that got an entry, is stale: the baseline only shrinks", () => {
    const folders = ["apps/daemon/src/board", "apps/daemon/src/server"];
    expect(checkDomains(folders, new Set(["board", "server"]), ["server", "store"])).toEqual({
      missing: [],
      stale: ["server", "store"],
    });
  });

  test("the folders of each root, skipping a root that does not exist", () => {
    const tree: Record<string, string[]> = { "a/src": ["board", "vault"], "b/src": [] };
    expect(domainFolders(["a/src", "b/src", "c/src"], (dir) => tree[dir] ?? null)).toEqual([
      "a/src/board",
      "a/src/vault",
    ]);
  });

  test("every domain folder of the repository has an entry in docs/GLOSSARY.md", () => {
    const list = (dir: string): string[] | null => {
      try {
        return readdirSync(join(ROOT, dir), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch {
        return null;
      }
    };
    const folders = domainFolders(DOMAIN_ROOTS, list);
    expect(folders.length).toBeGreaterThan(50);
    const glossary = glossaryDomains(readFileSync(join(ROOT, "docs/GLOSSARY.md"), "utf8"));
    const baseline = LAYER_FOLDERS.map((layer) => layer.name);
    expect(checkDomains(folders, glossary, baseline)).toEqual({ missing: [], stale: [] });
  });
});
