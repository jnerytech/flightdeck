import type { AppStore } from "../../lib/app-store.ts";

/** The prompt cache countdown of an idle session: warm, in its last minute, then cold. */
export function CacheTimer(props: { store: AppStore; since: string | null | undefined }) {
  void props;
  return null;
}
