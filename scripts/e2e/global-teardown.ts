/** Stops the demo and everything under it, whether or not the setup got to the end. */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { stopDemo } from "../lib/e2e-demo.ts";
import { STATE_DIR } from "./global-setup.ts";

export default async function globalTeardown() {
  stopDemo(
    STATE_DIR,
    {
      read: (path) => {
        try {
          return readFileSync(path, "utf8");
        } catch {
          return null;
        }
      },
      remove: (path) => rmSync(path, { force: true }),
    },
    {
      platform: process.platform,
      kill: (pid, signal) => process.kill(pid, signal as NodeJS.Signals),
      run: ([command, ...args]) => {
        try {
          execFileSync(command as string, args, { stdio: "ignore" });
        } catch {
          // Already gone.
        }
      },
    },
  );
}
