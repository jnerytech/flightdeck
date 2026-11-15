import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "./helpers.ts";

/** A plugin folder with the given files (path to text). */
export function plugin(files: Record<string, string>): string {
  const dir = join(tempDir("fd-plugin-"), "p");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

export const MANIFEST = JSON.stringify({
  name: "deploy-tools",
  version: "1.2.0",
  description: "Deploys",
  author: { name: "Equipe" },
});
export const skill = (name: string) => `---\nname: ${name}\ndescription: faz ${name}\n---\ncorpo\n`;
