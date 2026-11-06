/**
 * How the demo serves the web entry (#444): Vite's dev server for a person, or, with
 * `DEMO_BUILD=1` (CI's e2e and prints jobs), a production build served by `vite preview`. The dev
 * server sends every module on each page load; a journey reloads the page about a hundred times.
 */

export interface ViteCommands {
  /** The build to run first and wait for, or null for the dev server. */
  build: string[] | null;
  /** The server to start; it prints `Local:` when ready. */
  serve: string[];
}

export function viteCommands(options: {
  env: Readonly<Record<string, string | undefined>>;
  bun: string;
  vite: string;
  port: number;
  outDir: string;
}): ViteCommands {
  return { build: null, serve: [options.bun] };
}
