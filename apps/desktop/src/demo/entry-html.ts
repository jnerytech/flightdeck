/**
 * index.html with the web entry when `FLIGHTDECK_ENTRY=web` (the demo and the prints).
 *
 * vite.config.ts imports it, so it imports nothing: whatever the config reaches, Vite may leave to
 * Node, which cannot strip all of the app's TypeScript (scripts/test/bundle-reach.test.ts).
 */
export function entryHtml(html: string, entry: string | undefined): string {
  return entry === "web" ? html.replace("/src/main.tsx", "/src/main.web.tsx") : html;
}
