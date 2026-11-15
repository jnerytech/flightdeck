import { resolve } from "node:path";
import { defaultConfigPath, expandHome } from "../config.ts";
import type { CliArgs } from "./domain/args.ts";

/** The config file the command line names (`--config`), else the default one, as an absolute path. */
export function configPath(args: CliArgs): string {
  return resolve(expandHome(args.config ?? defaultConfigPath()));
}
