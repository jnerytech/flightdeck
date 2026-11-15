import type { Route } from "@/lib/router.ts";
import type { TopSession } from "./page.tsx";

type OpenCostSession = (hostId: string, session: TopSession) => void;

/** One opener per `go`, so the `memo` of the costs page that gets it holds between renders. */
const COSTS_OPENERS = new WeakMap<(route: Route) => void, OpenCostSession>();
export function costsOpener(go: (route: Route) => void): OpenCostSession {
  let opener = COSTS_OPENERS.get(go);
  if (!opener) {
    opener = (hostId, session) =>
      go(
        session.sessionId
          ? { name: "session", host: hostId, id: session.sessionId }
          : { name: "reader", target: { hostId, claudeSessionId: session.claudeSessionId } },
      );
    COSTS_OPENERS.set(go, opener);
  }
  return opener;
}
