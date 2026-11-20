import { packPersonas } from "../../src/personas/pack.ts";
import { Personas } from "../../src/personas/store.ts";
import { SecretScanner } from "../../src/snippets/domain/model.ts";
import { EventStore } from "../../src/store/event-store.ts";
import { workspace } from "../support/helpers.ts";

export const scanner = new SecretScanner();
export const SPEC_IDS = [
  "architect",
  "security",
  "qa",
  "sre",
  "performance",
  "reviewer",
  "docs",
  // Issue #1961: the one that turns a request into an issue, right after docs.
  "specifier",
  "frontend",
  // Issue #1936: the two that judge the interface, right after the one that builds it.
  "ux",
  "ui",
  "dba",
  // Phase 21 coordinates its teams with this one.
  "coordinator",
  // Issue #92: the one that writes the code, the default worker of a team.
  "dev",
];

export function setup() {
  const { root, project } = workspace();
  const personas = new Personas({
    db: new EventStore(":memory:").db,
    allowedRoots: [root],
    scanner,
    pack: packPersonas,
  });
  return { root, project, personas };
}

export const edit = (id: string, body: string) => ({
  id,
  name: "Minha versão",
  description: "Editada",
  body,
});
