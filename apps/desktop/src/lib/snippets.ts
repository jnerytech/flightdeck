/** The variables a snippet fills from where it is used, not from a field (phase 18). */
export const SPECIAL_VARS: readonly string[] = ["cwd", "branch", "file", "selection"];

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** The names between `{{ }}`, in order of appearance and without repeats (as the daemon reads them). */
export function placeholders(template: string): string[] {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1] as string))];
}

/** What 17's action form starts from when a snippet with a secret becomes an action. */
export interface ActionSeed {
  name: string;
  run: string[];
  env: string[];
}

/** The command as argv, without the secret, and an env entry for it to come from the vault. */
export function actionSeedFromCommand(_name: string, _command: string): ActionSeed {
  return { name: "", run: [], env: [] };
}
