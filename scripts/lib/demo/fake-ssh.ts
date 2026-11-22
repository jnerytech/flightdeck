import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { installSshTools } from "../smoke/ssh-tools.ts";

/** What the journey types at the password prompt: a test constant, only its hash reaches the fake `ssh`. */
export const DEMO_SSH_PASSWORD = "demo-password-not-a-secret";

/** The server the journey's password destination points at, in the language of its run (`en`, `pt-br`). */
export function demoSshHost(lang: string): string {
  return `pw-${lang}.example.test`;
}

/** One key per language run, as a server would show it: the bytes only have to be stable. */
const hostKey = (host: string) =>
  `ssh-ed25519 ${Buffer.from(`demo-host-key-${host}`).toString("base64")}`;

export interface DemoSsh {
  /** The fake `ssh`, for a host's `ssh.path`. */
  ssh: string;
  /** Takes the fake folder off the PATH it was put on. */
  restore(): void;
}

/**
 * The fake OpenSSH of the demo (#3989): `ssh` and `ssh-keyscan` in a folder put first on `env.PATH`, which the
 * demo's in-process daemons read, so Connections can pin a server and a password destination can run its ssh.
 * What the fakes answer with (the server keys, the hash of the password) is written into their wrappers, not
 * into `env`, so no other program of the demo sees it. `holdMs` is how long the fake `ssh` stays up after it
 * connects, for a screen to read its line.
 */
export function installDemoSsh(
  work: string,
  env: Record<string, string | undefined> = process.env,
  holdMs = 10_000,
): DemoSsh {
  const keys = Object.fromEntries(
    ["en", "pt-br"].map((lang) => [demoSshHost(lang), hostKey(demoSshHost(lang))]),
  );
  const keysFile = join(work, "ssh-keys.json");
  writeFileSync(keysFile, JSON.stringify(keys));
  const { ssh } = installSshTools(join(work, "ssh-bin"), {
    FD_FAKE_KEYS: keysFile,
    FD_FAKE_PASSWORD_SHA256: createHash("sha256").update(DEMO_SSH_PASSWORD).digest("hex"),
    FD_FAKE_HOLD_MS: String(holdMs),
  });
  const dir = dirname(ssh);
  env.PATH = [dir, env.PATH].filter(Boolean).join(delimiter);
  return {
    ssh,
    // Takes out only this folder, so the order of several restores does not matter.
    restore: () => {
      env.PATH = (env.PATH ?? "")
        .split(delimiter)
        .filter((entry) => entry !== dir)
        .join(delimiter);
    },
  };
}
