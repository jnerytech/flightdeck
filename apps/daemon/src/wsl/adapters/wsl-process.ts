/**
 * The `wsl.exe` program as a process (#1612): the one place the daemon launches a command inside
 * a WSL distro from. The supervisor hands it an item and a log file and gets back the child.
 */
import type { Subprocess } from "bun";

/** `wsl.exe -d <distro> --exec bash -lc "<command>"`: a login shell, so ~/.profile applies. */
export function wslCommand(item: { distro: string; command: string }): string[] {
  return ["wsl.exe", "-d", item.distro, "--exec", "bash", "-lc", item.command];
}

/** Starts `command` with no stdin and its output and errors going to the open log file `logFd`. */
export function spawnLogged(command: string[], logFd: number): Subprocess {
  return Bun.spawn(command, { stdin: "ignore", stdout: logFd, stderr: logFd });
}
