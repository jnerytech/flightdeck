#!/usr/bin/env bun
/**
 * `bun run demo` (phase 10): seeds two fake-runtime daemons (scripts/demo-seed.ts) and serves the
 * app's web entry with Vite, already paired with them, at http://localhost:1420. Ctrl+C stops it.
 * `--shots` takes the prints (scripts/demo-shots.ts) into apps/desktop/screenshots/ and exits.
 */
import { renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { seedDemo } from "./demo-seed.ts";
import { SHOTS_DIR, takeShots } from "./demo-shots.ts";
import { runVisual } from "./demo-visual.ts";
import { stateFile } from "./lib/e2e-demo.ts";
import { visualMode } from "./lib/visual.ts";

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
    const visual = visualMode(process.env, process.argv);
    const dir = await takeShots(url, seed.ids, browserEnv, log, visual);
    runVisual(visual, SHOTS_DIR, log);
    console.log(`DEMO SHOTS OK: ${dir}`);
  } finally {
    await stop();
  }
  process.exit(0);
}

// `--serve` (the e2e runner): writes the address and ids where the runner waits for them and stays
// up until it is stopped. The runner stops the whole process group.
if (process.argv.includes("--serve")) {
  const dir = process.env.E2E_STATE_DIR;
  if (!dir) throw new Error("--serve precisa de E2E_STATE_DIR");
  const file = stateFile(dir);
  // Written whole and then renamed, so the runner never reads half of it.
  writeFileSync(`${file}.tmp`, JSON.stringify({ url, ids: seed.ids }));
  renameSync(`${file}.tmp`, file);
  const done = () => void stop().then(() => process.exit(0));
  process.on("SIGTERM", done);
  process.on("SIGINT", done);
  await new Promise(() => {});
}

console.log(`\nFlightdeck demo em ${url} (Ctrl+C para sair)`);
process.on("SIGINT", () => {
  void stop().then(() => process.exit(0));
});
