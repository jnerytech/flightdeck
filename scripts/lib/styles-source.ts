/**
 * The app's stylesheet as one text (#1599): `styles.css` and the files it pulls in with a local
 * `@import "./styles/<feature>.css";` line, each put in place of its line. A test that checks a
 * rule reads this instead of the entry file, so it does not care which file holds the rule.
 */
import { readFileSync } from "node:fs";

export function readStyles(entry: string | URL): string {
  return readFileSync(entry, "utf8");
}
