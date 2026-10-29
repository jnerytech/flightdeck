import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Events installed as http hooks; SessionStart is a command hook (its http form never fires). */
export const HTTP_HOOK_EVENTS = [
  "UserPromptSubmit",
  "Notification",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionDenied",
  "Stop",
  "SessionEnd",
] as const;

/** Every hook but the held permission request answers within this. */
const HOOK_TIMEOUT_S = 5;

export interface HookTarget {
  /** This daemon's own executable (`[binary]` or `[bun, "run", bin.ts]`), absolute. */
  command: string[];
  /** Receptor base URL, with the port the daemon really listens on. */
  url: string;
  token: string;
  permissionTimeoutS: number;
}

export interface HookEntry {
  type: "command" | "http";
  command?: string;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface HookGroup {
  matcher?: string;
  hooks: HookEntry[];
}

export type HooksStatus = "installed" | "absent" | "outdated";

type Settings = Record<string, unknown> & { hooks?: Record<string, HookGroup[]> };

/** Quotes only what needs it, so the line reads the same in sh, cmd and PowerShell. */
const quote = (arg: string) => (/\s/.test(arg) ? `"${arg}"` : arg);

/** The entries `install` writes, by event. */
export function hookEntries(target: HookTarget): Record<string, HookGroup[]> {
  const sessionStart = [
    ...target.command.map(quote),
    "hook",
    "session-start",
    "--url",
    target.url,
    "--token",
    target.token,
  ].join(" ");
  const entries: Record<string, HookGroup[]> = {
    SessionStart: [
      { hooks: [{ type: "command", command: sessionStart, timeout: HOOK_TIMEOUT_S }] },
    ],
  };
  for (const event of HTTP_HOOK_EVENTS) {
    const timeout = event === "PermissionRequest" ? target.permissionTimeoutS : HOOK_TIMEOUT_S;
    entries[event] = [
      {
        hooks: [
          {
            type: "http",
            url: `${target.url}/hooks/${event}`,
            headers: { Authorization: `Bearer ${target.token}` },
            timeout,
          },
        ],
      },
    ];
  }
  return entries;
}

/** Flightdeck's entries: the receptor URL or the `hook session-start` command. */
export const isFlightdeckHook = (hook: HookEntry) =>
  /^http:\/\/127\.0\.0\.1:\d+\/hooks\//.test(hook.url ?? "") ||
  (hook.command ?? "").includes(" hook session-start ");

function readSettings(file: string): Settings | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Settings) : null;
}

function writeSettings(file: string, settings: Settings): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Drops Flightdeck's hooks; groups, events and `hooks` emptied by that go too. */
function withoutFlightdeck(settings: Settings): { settings: Settings; changed: boolean } {
  let changed = false;
  const hooks: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const kept = groups.flatMap((group) => {
      const others = group.hooks.filter((hook) => !isFlightdeckHook(hook));
      if (others.length === group.hooks.length) return [group];
      changed = true;
      return others.length > 0 ? [{ ...group, hooks: others }] : [];
    });
    if (kept.length > 0) hooks[event] = kept;
  }
  const { hooks: _hooks, ...rest } = settings;
  return { settings: Object.keys(hooks).length > 0 ? { ...rest, hooks } : rest, changed };
}

/**
 * Merges Flightdeck's hooks into `settings.json`, keeping every other key and hook, after a
 * `.flightdeck-backup` copy. Installing again replaces the old entries instead of adding more.
 */
export function installHooks(file: string, target: HookTarget): void {
  const current = readSettings(file);
  if (current) writeFileSync(`${file}.flightdeck-backup`, readFileSync(file));
  const { settings } = withoutFlightdeck(current ?? {});
  const hooks = { ...settings.hooks };
  for (const [event, groups] of Object.entries(hookEntries(target))) {
    hooks[event] = [...(hooks[event] ?? []), ...groups];
  }
  writeSettings(file, { ...settings, hooks });
}

/** Removes only Flightdeck's entries; false when there were none. */
export function uninstallHooks(file: string): boolean {
  const current = readSettings(file);
  if (!current) return false;
  const { settings, changed } = withoutFlightdeck(current);
  if (changed) writeSettings(file, settings);
  return changed;
}

/** Installed as `install` would write it now, absent, or different (outdated). */
export function hooksStatus(file: string, target: HookTarget): HooksStatus {
  const found: Record<string, HookEntry[]> = {};
  for (const [event, groups] of Object.entries(readSettings(file)?.hooks ?? {})) {
    const ours = groups.flatMap((group) => group.hooks.filter(isFlightdeckHook));
    if (ours.length > 0) found[event] = ours;
  }
  if (Object.keys(found).length === 0) return "absent";
  const expected = Object.fromEntries(
    Object.entries(hookEntries(target)).map(([event, groups]) => [
      event,
      groups.flatMap((g) => g.hooks),
    ]),
  );
  return JSON.stringify(sortKeys(found)) === JSON.stringify(sortKeys(expected))
    ? "installed"
    : "outdated";
}

const sortKeys = (value: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
