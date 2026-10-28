import { posix, win32 } from "node:path";

/** Unit file location, relative to the user's home. */
export const SYSTEMD_UNIT_PATH = ".config/systemd/user/flightdeckd.service";

const isCompiled = (main: string) => main.includes("$bunfs") || main.includes("~BUN");

/**
 * The command that starts this daemon: the binary itself when compiled, otherwise
 * `bun run <bin.ts>`. `start` is appended by each service format.
 */
export function daemonCommand(execPath: string, main: string): string[] {
  return isCompiled(main) ? [execPath] : [execPath, "run", main];
}

function requireAbsolute(command: string[]): void {
  const exe = command[0] ?? "";
  if (!posix.isAbsolute(exe) && !win32.isAbsolute(exe)) {
    throw new Error(`o serviço precisa de caminho absoluto, recebido: ${exe}`);
  }
}

/** systemd quoting: arguments with spaces or quotes go inside double quotes. */
const systemdQuote = (arg: string) =>
  /[\s"\\]/.test(arg) ? `"${arg.replace(/(["\\])/g, "\\$1")}"` : arg;

/** User unit for `systemctl --user`, restarting forever five seconds after any exit. */
export function systemdUnit(command: string[]): string {
  requireAbsolute(command);
  return [
    "[Unit]",
    "Description=Flightdeck daemon (flightdeckd)",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${[...command, "start"].map(systemdQuote).join(" ")}`,
    "Restart=always",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}
