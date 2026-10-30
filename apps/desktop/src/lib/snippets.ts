import { SecretScanner } from "@flightdeck/protocol";

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
  /** Env entries for secrets the person picks in the vault; none when only a command is handed over. */
  env?: string[];
}

/** Splits a one-line command into words the way a shell would, quotes kept together. */
function words(command: string): string[] {
  const found: string[] = [];
  let word = "";
  let quote: string | null = null;
  let started = false;
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null;
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) found.push(word);
      word = "";
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (started) found.push(word);
  return found;
}

/** An env name for a secret: the assignment's own name, a flag's, or SECRET (made unique). */
function envNameOf(word: string, taken: Set<string>): string {
  const assigned = word.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1];
  const flag = word.match(/^--?([A-Za-z][A-Za-z0-9-]*)=/)?.[1];
  const base = (assigned ?? flag?.replaceAll("-", "_") ?? "SECRET").toUpperCase();
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
  taken.add(name);
  return name;
}

/**
 * The command as argv, without the secret, and an env entry for it to come from the vault: a
 * secret never travels as an argument (phase 17). A word the scanner flags is dropped whole, so
 * its value is never carried over; the person points the program at the variable.
 */
export function actionSeedFromCommand(name: string, command: string): ActionSeed {
  const scanner = new SecretScanner();
  const taken = new Set<string>();
  const run: string[] = [];
  const env: string[] = [];
  for (const [i, word] of words(command).entries()) {
    if (i === 0 && word === "export") continue;
    if (scanner.scan(word).length > 0) env.push(envNameOf(word, taken));
    else run.push(word);
  }
  return { name, run, env };
}
