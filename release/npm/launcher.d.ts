import type { ChildProcess } from "node:child_process";

/** The binary file of each `<platform>-<arch>` the tarball carries. */
export const BINARIES: Record<string, string>;
export function binaryFor(platform: string, arch: string): string | null;
export function exitCodeOf(code: number | null, signal: string | null): number;

export interface LauncherDeps {
  dir: string;
  platform: string;
  arch: string;
  argv: string[];
  spawn(path: string, args: string[], options: { stdio: "inherit" }): ChildProcess;
  stderr(line: string): void;
  exit(code: number): void;
  trap(signal: string, handler: () => void): void;
}
export function launch(name: "fd" | "flightdeckd", deps: LauncherDeps): void;
export function main(name: "fd" | "flightdeckd"): void;
