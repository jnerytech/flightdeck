import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Config } from "../config.ts";
import { layoutLike, parseJsonText, writeFileAtomic } from "../kernel/index.ts";
import {
  type HookSettings,
  type HooksStatus,
  type HookTarget,
  hooksStatusOf,
  withFlightdeck,
  withoutFlightdeck,
} from "./domain/hook-entries.ts";

async function readSettings(file: string): Promise<HookSettings | null> {
  const text = await readFile(file, "utf8").catch(() => null);
  return text === null ? null : (parseJsonText(text) as HookSettings);
}

/** Written in the layout the file has (its BOM, indent and line endings): only the hooks change. */
async function writeSettings(file: string, settings: HookSettings): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const before = await readFile(file, "utf8").catch(() => null);
  await writeFileAtomic(file, layoutLike(before, settings));
}

/**
 * Merges Flightdeck's hooks into `settings.json`, keeping every other key and hook, after a
 * `.flightdeck-backup` copy. Installing again replaces the old entries instead of adding more.
 */
export async function installHooks(file: string, target: HookTarget): Promise<void> {
  const current = await readSettings(file);
  if (current) await writeFile(`${file}.flightdeck-backup`, await readFile(file));
  await writeSettings(file, withFlightdeck(current ?? {}, target));
}

/** Removes only Flightdeck's entries; false when there were none. */
export async function uninstallHooks(file: string): Promise<boolean> {
  const current = await readSettings(file);
  if (!current) return false;
  const { settings, changed } = withoutFlightdeck(current);
  if (changed) await writeSettings(file, settings);
  return changed;
}

/** Installed as `install` would write it now, absent, or different (outdated). */
export async function hooksStatus(file: string, target: HookTarget): Promise<HooksStatus> {
  return hooksStatusOf(await readSettings(file), target);
}

/** What `hooks install` writes for this config: this executable, the receptor and its token. */
export function hookTarget(
  config: Config,
  selfCommand: string[],
  port = config.hooks.port,
): HookTarget {
  return {
    command: selfCommand,
    url: `http://127.0.0.1:${port}`,
    token: config.hooks.token ?? "",
    permissionTimeoutS: config.hooks.permissionTimeoutS,
  };
}
