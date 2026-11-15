import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { PluginFiles } from "../ports.ts";

/** The plugin folders on disk: the catalog a marketplace keeps in its folder, and real paths. */
export const diskPluginFiles: PluginFiles = {
  readCatalog: (location) => readFile(join(location, ".claude-plugin", "marketplace.json"), "utf8"),
  realpath,
};
