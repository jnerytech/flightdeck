import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadConfig, updateConfigFile } from "./config.ts";

export interface SetupDeps {
  /** Free-text question; an empty answer means "nothing". */
  ask(question: string): Promise<string>;
  confirm(question: string, fallback: boolean): Promise<boolean>;
  log: { log(message: string): void; error(message: string): void };
  configFile: string;
  /** `~` in an answer means this home. */
  home: string;
  isDirectory(path: string): boolean;
  tailscaleIp(): Promise<string | null>;
  /** Puts the running binary at its stable place; false when running from source. */
  installBinary(): boolean;
  /** Installs the service, starts it now and waits for `/health`; throws when it never answers. */
  installService(): Promise<void>;
  installHooks(): void;
  /** Prints the pairing link. */
  pair(): Promise<void>;
}

/** What Tailscale uses: the CGNAT range of IPv4 and the ULA range of IPv6. */
const TAILSCALE_NETWORKS = ["100.64.0.0/10", "fd7a:115c:a1e0::/48"];

const expandHome = (path: string, home: string) =>
  path === "~" || path.startsWith("~/") || path.startsWith("~\\")
    ? resolve(home, path.slice(2))
    : resolve(path);

/** The absolute path of a folder answer, or why it cannot be one. */
function checkFolder(deps: SetupDeps, answer: string): { path: string; error?: string } {
  const path = expandHome(answer, deps.home);
  return deps.isDirectory(path)
    ? { path }
    : { path, error: `${path} is not a folder that exists: type the path of a folder.` };
}

/** Asks for project folders, one per answer, until the user is done. */
async function askFolders(deps: SetupDeps, current: string[]): Promise<string[]> {
  const roots = [...current];
  if (roots.length) deps.log.log(`Folders already allowed: ${roots.join(", ")}`);
  for (;;) {
    const answer = (
      await deps.ask("Project folder Flightdeck may start sessions in (empty answer to finish): ")
    ).trim();
    if (answer) {
      const { path, error } = checkFolder(deps, answer);
      if (error) deps.log.error(error);
      else if (!roots.includes(path)) roots.push(path);
      continue;
    }
    if (roots.length) return roots;
    const insist = await deps.confirm(
      "Continue without project folders? Flightdeck cannot start a session anywhere until you add one to allowedRoots.",
      false,
    );
    if (insist) return roots;
  }
}

export interface SetupOptions {
  /** Non-interactive: no question is asked, every default stands. */
  yes?: boolean;
  /** The folders to allow in `yes` mode. */
  folders?: string[];
}

const INPUT_CLOSED =
  "input closed: run setup in a terminal, or pass --yes --folders <a,b> to skip the questions";

/** Line-based questions over `input`; fails when the input ends instead of answering nothing. */
export function createPrompt(
  input: AsyncIterable<string>,
  write: (text: string) => void,
): Pick<SetupDeps, "ask" | "confirm"> {
  const lines = input[Symbol.asyncIterator]();
  const ask = async (question: string): Promise<string> => {
    write(question);
    const line = await lines.next();
    if (line.done) throw new Error(INPUT_CLOSED);
    return line.value;
  };
  const confirm = async (question: string, fallback: boolean): Promise<boolean> => {
    const hint = fallback ? "[Y/n]" : "[y/N]";
    for (;;) {
      const answer = (await ask(`${question} ${hint} `)).trim().toLowerCase();
      if (answer === "") return fallback;
      if (answer === "y" || answer === "yes") return true;
      if (answer === "n" || answer === "no") return false;
      write("Please answer y or n.\n");
    }
  };
  return { ask, confirm };
}

/** The folders of `--yes` mode: the ones given plus the config's, each one checked. */
function yesFolders(deps: SetupDeps, current: string[], given: string[]): string[] {
  const roots = [...current];
  for (const answer of given) {
    const { path, error } = checkFolder(deps, answer);
    if (error) throw new Error(error);
    if (!roots.includes(path)) roots.push(path);
  }
  if (!roots.length) throw new Error("no project folder: pass --folders <a,b>");
  return roots;
}

/** `flightdeckd setup`: the first run, step by step. */
export async function runSetup(deps: SetupDeps, options: SetupOptions = {}): Promise<void> {
  const config = loadConfig(deps.configFile);
  // Checked before anything is installed: a bad answer on the command line changes nothing.
  const given = options.yes ? yesFolders(deps, config.allowedRoots, options.folders ?? []) : null;
  if (!deps.installBinary()) {
    deps.log.log("Running from source: the binary stays where it is.");
  }
  const roots = given ?? (await askFolders(deps, config.allowedRoots));
  const tailscale = options.yes ? null : await deps.tailscaleIp();
  const remote =
    tailscale !== null &&
    (await deps.confirm(
      `Tailscale found (${tailscale}). Use Flightdeck from other devices over Tailscale?`,
      false,
    ));
  updateConfigFile(deps.configFile, (raw) => ({
    ...raw,
    allowedRoots: roots,
    ...(remote
      ? {
          bind: tailscale,
          allowedNetworks: [...new Set([...config.allowedNetworks, ...TAILSCALE_NETWORKS])],
        }
      : {}),
  }));
  if (
    options.yes ||
    (await deps.confirm("Install the Claude Code hooks (live status of your sessions)?", true))
  ) {
    deps.installHooks();
  }
  try {
    await deps.installService();
  } catch (error) {
    deps.log.error(
      `${error instanceof Error ? error.message : String(error)}\nRun "flightdeckd doctor" to see what is wrong and how to fix it.`,
    );
    throw error;
  }
  await deps.pair();
}

/**
 * Puts the running binary at the stable place (`~/.flightdeck/bin`). A binary already there is
 * kept: replacing it is what `update` does, with the service stopped.
 */
export function installStableBinary(
  self: string[],
  stable: string,
  platform: string,
): "source" | "already" | "kept" | "copied" {
  const exe = self[0] as string;
  if (self.length !== 1) return "source";
  const same = (a: string, b: string) =>
    platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (same(resolve(exe), resolve(stable))) return "already";
  if (existsSync(stable)) return "kept";
  mkdirSync(dirname(stable), { recursive: true });
  copyFileSync(exe, stable);
  chmodSync(stable, 0o755);
  return "copied";
}
