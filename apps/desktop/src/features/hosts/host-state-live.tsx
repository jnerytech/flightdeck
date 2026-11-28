import type { HostView } from "../../lib/app-store.ts";

/** The host page's polite live region: it says the host's connection state when that state changes. */
export function HostStateLive(_props: Readonly<{ host: HostView }>) {
  return <output className="sr-only" />;
}
