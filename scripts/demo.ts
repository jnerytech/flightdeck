#!/usr/bin/env bun
/**
 * `bun run demo` (phase 10): seeds two fake-runtime daemons (scripts/demo-seed.ts) and serves the
 * app's web entry with Vite, already paired with them, at http://localhost:1420. Ctrl+C stops it.
 * `--shots` takes the prints (scripts/demo-shots.ts) into apps/desktop/screenshots/ and exits.
 */
import { join, resolve } from "node:path";
import { runE2e } from "./demo-e2e.ts";
import { seedDemo } from "./demo-seed.ts";
import { takeShots } from "./demo-shots.ts";

const DESKTOP = resolve(import.meta.dir, "../apps/desktop");
const PORT = 1420;
const log = (msg: string) => console.log(`  · ${msg}`);

// The seed points HOME at a temporary folder; the browser of the prints needs the real one to
// find its own system paths (its profile is still a temporary one).
const browserEnv = { ...process.env } as Record<string, string>;
const seed = await seedDemo(log);
// Vite itself under this Bun (one process, so stopping it leaves no server behind).
const VITE = join(DESKTOP, "node_modules/vite/bin/vite.js");
const vite = Bun.spawn([process.execPath, VITE, "--port", String(PORT), "--strictPort"], {
  cwd: DESKTOP,
  env: { ...process.env, FLIGHTDECK_ENTRY: "web", VITE_DEMO_HOSTS: JSON.stringify(seed.hosts) },
  stdout: "pipe",
  stderr: "inherit",
});

const url = `http://localhost:${PORT}/`;
/** Terminal color codes (ESC [ … m), which split Vite's words. */
const ANSI_COLOR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
// Vite announces itself on stdout when ready.
const decoder = new TextDecoder();
let banner = "";
for await (const chunk of vite.stdout) {
  banner += decoder.decode(chunk, { stream: true }).replace(ANSI_COLOR, "");
  if (banner.includes("Local:")) break;
}
if (!banner.includes("Local:")) {
  // Typically the port is taken: never print another server's screens.
  await seed.stop();
  throw new Error(`o Vite não subiu na porta ${PORT}:
${banner}`);
}

const stop = async () => {
  vite.kill();
  await seed.stop();
};

if (process.argv.includes("--shots")) {
  try {
    const dir = await takeShots(url, seed.ids, browserEnv, log);
    console.log(`DEMO SHOTS OK: ${dir}`);
  } finally {
    await stop();
  }
  process.exit(0);
}

if (process.argv.includes("--e2e")) {
  let failed = false;
  try {
    await runE2e(url, seed.ids, browserEnv, log);
    console.log("E2E OK");
  } catch (error) {
    failed = true;
    console.error((error as Error).message);
  } finally {
    await stop();
  }
  process.exit(failed ? 1 : 0);
}

console.log(`\nFlightdeck demo em ${url} (Ctrl+C para sair)`);
process.on("SIGINT", () => {
  void stop().then(() => process.exit(0));
});
