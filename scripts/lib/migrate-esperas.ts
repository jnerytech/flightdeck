/** The codemod that replaces a test file's own `settle` with the shared one (apps/desktop/test/wait.ts). */

const DEFAULT_MS = "5000";

const OWN_SETTLE =
  /^async function settle\(check: \(\) => boolean, timeoutMs = ([\d_]+)\): Promise<void> \{\n\s*const deadline = Date\.now\(\) \+ timeoutMs;\n\s*while \(!check\(\) && Date\.now\(\) < deadline\) await (act\(\(\) => )?Bun\.sleep\(\d+\)\)?;\n\}\n/m;

/** `source` with its own settle swapped for the shared one, or null when it has none. */
export function migrate(source: string, waitPath = "./wait.ts"): string | null {
  const own = OWN_SETTLE.exec(source);
  if (!own) return null;
  const ms = (own[1] as string).replaceAll("_", "");
  const inAct = own[2] !== undefined;
  const same = ms === DEFAULT_MS;
  const factory = inAct ? "waiter" : "plainWaiter";
  const imported = same ? (inAct ? "settle" : "settlePlain as settle") : factory;
  const replacement = same ? "" : `const settle = ${factory}(${own[1]});\n`;
  const without = source.replace(OWN_SETTLE, replacement);
  // After the last static import (the ones that end the line with `from "…";`).
  const imports = [...without.matchAll(/^(?:import .*|\} from .*);$/gm)];
  const last = imports.at(-1);
  const at = last ? (last.index as number) + last[0].length : 0;
  const line = `\nimport { ${imported} } from "${waitPath}";`;
  return without.slice(0, at) + line + without.slice(at);
}
