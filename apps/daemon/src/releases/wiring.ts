import { RELEASES_URL } from "../config.ts";
import type { DomainModule } from "../server/index.ts";
import { ReleaseFeed } from "./domain/releases.ts";

/** The published releases the app's "what's new" reads, as the module the server takes `releases` from. */
export function createReleases() {
  const module: DomainModule<"releases"> = {
    server: {
      releases: new ReleaseFeed({
        url: RELEASES_URL,
        fetch: globalThis.fetch.bind(globalThis),
        now: Date.now,
      }),
    },
  };
  return { modules: [module] as const };
}
