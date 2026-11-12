import type { GithubStatusResult } from "@flightdeck/protocol";
import { hostsWith } from "../../lib/version.ts";

/** What the sign-out list reads of the app's store and hosts, as plain shapes: the store and `HostView` satisfy them. */
interface GithubStatusAsker {
  hostCommand(
    hostId: string,
    type: "github.status",
    payload: Record<string, never>,
  ): Promise<GithubStatusResult | null | undefined>;
}
interface GithubCandidate {
  id: string;
  name: string;
  status: string;
  hostInfo?: { features?: readonly string[] | undefined } | null | undefined;
}

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
  store: GithubStatusAsker,
  hosts: readonly GithubCandidate[],
): Promise<GithubHost[]> {
  const answers = await Promise.all(
    hostsWith(hosts, "github").map(async (h) => ({
      host: h,
      status: await store.hostCommand(h.id, "github.status", {}),
    })),
  );
  return answers
    .filter(({ status }) => status?.installed && status.loggedIn && status.source !== "env")
    .map(({ host }) => ({ id: host.id, name: host.name }));
}
