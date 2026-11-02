import type { ServiceContext } from "./service.ts";

/** What the PATH helpers need of the OS: the platform, the home and a way to run commands. */
export type PathEnv = Pick<ServiceContext, "platform" | "home" | "exec">;

/** The folder with the stable binary (`~/.flightdeck/bin`) for this platform's paths. */
export function binDir(_env: PathEnv): string {
  return "";
}

/** Puts `dir` on the user's PATH; returns the lines to print. */
export async function addToUserPath(_env: PathEnv, _dir: string): Promise<string[]> {
  return [];
}

/** Takes `dir` off the user's PATH; returns the lines to print. */
export async function removeFromUserPath(_env: PathEnv, _dir: string): Promise<string[]> {
  return [];
}
