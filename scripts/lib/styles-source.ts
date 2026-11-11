/**
 * The app's stylesheet as one text (#1599): `styles.css` and the files it pulls in with a local
 * `@import "./styles/<feature>.css";` line, each put in place of its line. A test that checks a
 * rule reads this instead of the entry file, so it does not care which file holds the rule.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** A whole line that imports a stylesheet by a relative path; a package import is left alone. */
const LOCAL_IMPORT = /^@import\s+["'](\.{1,2}\/[^"']+\.css)["'];[ \t]*$/gm;

function inline(file: string): string {
  const text = readFileSync(file, "utf8");
  return text.replace(LOCAL_IMPORT, (_line, rel: string) => inline(resolve(dirname(file), rel)));
}

export function readStyles(entry: string | URL): string {
  return inline(typeof entry === "string" ? entry : fileURLToPath(entry));
}
