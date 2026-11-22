/**
 * Issue #3973: the snippets the demo seeds, so the Snippets prints have a list, a use dialog with
 * fields to fill, a project's versioned file and a shell history to import from.
 */
import type { SnippetInput } from "@flightdeck/protocol";

/** A snippet of the host, and whether the seed marks it a favorite. */
export interface DemoSnippet extends SnippetInput {
  favorite: boolean;
}

/** The command whose use dialog the print opens (it has a field with a default). */
export const DEMO_USE_COMMAND = "Rodar os testes";
/** The prompt whose Edit button the print opens. */
export const DEMO_EDIT_PROMPT = "Revisar o PR";

export const DEMO_SNIPPETS: readonly DemoSnippet[] = [
  {
    name: DEMO_USE_COMMAND,
    type: "command",
    run: "bun test {{pasta}}",
    vars: { pasta: { default: "apps/daemon" } },
    tags: ["testes"],
    favorite: true,
  },
  {
    name: "Subir o servidor",
    type: "command",
    run: "bun run dev --port {{porta}}",
    vars: { porta: { default: "3000" } },
    tags: ["dev"],
    favorite: false,
  },
  {
    name: DEMO_EDIT_PROMPT,
    type: "prompt",
    text: "Revise o PR {{numero}} e aponte riscos de segurança e testes que faltam.",
    vars: { numero: {} },
    tags: ["revisão"],
    favorite: false,
  },
  {
    name: "Resumo do dia",
    type: "prompt",
    text: "Resuma o que mudou hoje neste projeto, em cinco linhas.",
    favorite: false,
  },
];

/** The project's versioned file: what `snippets.save` takes with `target: "file"`. */
export const DEMO_FILE_SNIPPETS: readonly SnippetInput[] = [
  { name: "Checar os tipos", type: "command", run: "bun run typecheck", tags: ["ci"] },
  {
    name: "Lista do release",
    type: "prompt",
    text: "Confira o changelog, a versão e os testes antes de publicar.",
  },
];

/** The shell history the host reads (bash format, one command a line). */
export const DEMO_SHELL_HISTORY = [
  "git status",
  "bun run typecheck",
  "git status",
  "docker compose up -d",
  "bun test apps/daemon",
  "git status",
  "bun run typecheck",
  "git log --oneline -5",
  "",
].join("\n");

/** A file the import-from-a-file print picks (YAML). */
export const DEMO_IMPORT_FILE = [
  "- name: Limpar o cache",
  "  type: command",
  '  run: "rm -rf node_modules/.cache"',
  "- name: Explicar o erro",
  "  type: prompt",
  '  text: "Explique este erro e proponha a correção mínima."',
  "",
].join("\n");
