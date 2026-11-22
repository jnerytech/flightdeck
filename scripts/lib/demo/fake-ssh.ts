import { join } from "node:path";

/** What the journey types at the password prompt: a test constant, only its hash reaches the fake `ssh`. */
export const DEMO_SSH_PASSWORD = "";

/** The server the journey's password destination points at, in the language of its run (`en`, `pt-br`). */
export function demoSshHost(_lang: string): string {
  return "";
}

export interface DemoSsh {
  /** The fake `ssh`, for a host's `ssh.path`. */
  ssh: string;
  /** Takes the fake folder off the PATH it was put on. */
  restore(): void;
}

export function installDemoSsh(
  work: string,
  _env: Record<string, string | undefined> = process.env,
  _holdMs = 0,
): DemoSsh {
  return { ssh: join(work, "ssh"), restore: () => {} };
}
