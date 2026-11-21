/**
 * The background sessions domain's public entry (#1589): Claude Code's `claude --bg` sessions of a host, listed
 * and controlled from a shell. Other domains import only from here. `wiring.ts` and `service.ts` stay out:
 * `main.ts` takes `createBg` from `wiring.ts`, and `server-options.ts` takes the `BgService` type from `service.ts`.
 */

export { type BgCliArgs, runBgCli } from "./bg-cli.ts";
