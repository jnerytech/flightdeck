import type { AppStore, HostView } from "./app-store.ts";
import { hasFeature } from "./version.ts";

/** A host whose `gh` is signed in to GitHub and can sign out from the app. */
export interface GithubHost {
  id: string;
  name: string;
}

/**
 * The online hosts that offer GitHub and are signed in with a login the app can remove: a login
 * that comes from an environment variable of the daemon is left out (it is removed there).
 */
export async function githubSignedIn(
  store: Pick<AppStore, "hostCommand">,
  hosts: readonly HostView[],
): Promise<GithubHost[]> {
  const answers = await Promise.all(
    hosts
      .filter((h) => h.status === "online" && hasFeature(h.hostInfo?.features, "github", false))
      .map(async (h) => ({ host: h, status: await store.hostCommand(h.id, "github.status", {}) })),
  );
  return answers
    .filter(({ status }) => status?.installed && status.loggedIn && status.source !== "env")
    .map(({ host }) => ({ id: host.id, name: host.name }));
}
