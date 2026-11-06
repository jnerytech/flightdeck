import { posix, win32 } from "node:path";
import type { ServiceContext } from "./service.ts";

/** What the PATH helpers need of the OS: the platform, the home and a way to run commands. */
export type PathEnv = Pick<ServiceContext, "platform" | "home" | "exec"> & {
  /** The text of a file, or null when it is not there; with `writeFile`, lets Linux edit `~/.profile`. */
  readFile?(path: string): Promise<string | null>;
  writeFile?(path: string, content: string): void | Promise<void>;
};

const KEY = String.raw`HKCU\Environment`;
/** The registry types the user's Path can have; `REG_EXPAND_SZ` is what Windows itself writes. */
const DEFAULT_TYPE = "REG_EXPAND_SZ";

const isWindows = (env: PathEnv) => env.platform === "win32";

/** The folder with the stable binary (`~/.flightdeck/bin`) for this platform's paths. */
export function binDir(env: PathEnv): string {
  return (isWindows(env) ? win32 : posix).join(env.home, ".flightdeck", "bin");
}

/** An entry as Windows would compare it: `%USERPROFILE%` expanded, one slash, no trailing one, no case. */
function sameFolder(env: PathEnv, a: string, b: string): boolean {
  const norm = (entry: string) =>
    entry
      .trim()
      .replace(/%USERPROFILE%/gi, env.home)
      .replaceAll("/", "\\")
      .replace(/\\+$/, "")
      .toLowerCase();
  return norm(a) === norm(b);
}

/**
 * The user's Path as stored. `reg` is used instead of `setx`, which cuts a value at 1024
 * characters, and instead of .NET's `SetEnvironmentVariable`, which turns the value into a
 * `REG_SZ` and so loses its `%VARIABLES%`.
 */
async function readPath(env: PathEnv): Promise<{ value: string; type: string }> {
  const { code, stdout } = await env.exec(["reg", "query", KEY, "/v", "Path"]);
  const found =
    code === 0 ? /^\s*Path\s+(REG_SZ|REG_EXPAND_SZ)(?:\s+(.*?))?\s*$/im.exec(stdout) : null;
  return { value: found?.[2] ?? "", type: found?.[1] ?? DEFAULT_TYPE };
}

async function writePath(env: PathEnv, value: string, type: string): Promise<boolean> {
  const { code } = await env.exec(["reg", "add", KEY, "/v", "Path", "/t", type, "/d", value, "/f"]);
  return code === 0;
}

/** Tells open programs (Explorer, so new terminals) that the environment changed. */
const BROADCAST = [
  "Add-Type -Namespace Fd -Name Native -MemberDefinition '[DllImport(\"user32.dll\", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);'",
  "$r = [UIntPtr]::Zero",
  "[Fd.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$r) | Out-Null",
].join("; ");

async function broadcast(env: PathEnv): Promise<boolean> {
  const { code } = await env.exec([
    "powershell",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    BROADCAST,
  ]);
  return code === 0;
}

const entries = (value: string) => value.split(";").filter((entry) => entry.trim() !== "");

const profileLine = (dir: string) => `export PATH="${dir}:$PATH"`;

/** What to do by hand when the profile cannot be edited. */
const byHand = (dir: string) => [
  'To run "flightdeckd" from any folder, add this line to your shell profile:',
  `  ${profileLine(dir)}`,
];

/** Linux and macOS: appends the folder to `~/.profile` once; without file access, says how. */
async function addToProfile(env: PathEnv, dir: string): Promise<string[]> {
  const { readFile, writeFile } = env;
  if (!readFile || !writeFile) return byHand(dir);
  const file = posix.join(env.home, ".profile");
  const line = profileLine(dir);
  const current = (await readFile(file)) ?? "";
  if (current.includes(line)) return [`${dir} is already in ${file}.`];
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  try {
    await writeFile(file, `${current}${separator}# Flightdeck\n${line}\n`);
  } catch {
    return [`Flightdeck could not edit ${file}.`, ...byHand(dir)];
  }
  return [`Added ${dir} to your PATH in ${file}.`, 'Open a new terminal to use "flightdeckd".'];
}

/** Puts `dir` on the user's PATH; returns the lines to print. */
export async function addToUserPath(env: PathEnv, dir: string): Promise<string[]> {
  if (!isWindows(env)) return addToProfile(env, dir);
  const { value, type } = await readPath(env);
  if (entries(value).some((entry) => sameFolder(env, entry, dir))) {
    return [`${dir} is already on your Path.`];
  }
  if (!(await writePath(env, [...entries(value), dir].join(";"), type))) {
    return [
      `Flightdeck could not add ${dir} to your Path. Add it yourself in Settings > System > About > Advanced system settings > Environment Variables.`,
    ];
  }
  return [
    `Added ${dir} to your Path.`,
    ...((await broadcast(env))
      ? ['Open a new terminal to use "flightdeckd".']
      : [
          'Open a new terminal to use "flightdeckd"; if it does not find it, sign out and in again.',
        ]),
  ];
}

/** Takes `dir` off the user's PATH; returns the lines to print. */
export async function removeFromUserPath(env: PathEnv, dir: string): Promise<string[]> {
  if (!isWindows(env)) return [];
  const { value, type } = await readPath(env);
  const kept = entries(value).filter((entry) => !sameFolder(env, entry, dir));
  if (kept.length === entries(value).length) return [];
  if (!(await writePath(env, kept.join(";"), type))) {
    return [`Flightdeck could not remove ${dir} from your Path: remove it yourself.`];
  }
  await broadcast(env);
  return [`Path entry removed: ${dir}`];
}
