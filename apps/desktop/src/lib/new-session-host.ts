import type { HostView, Selection } from "./app-store.ts";

/** The host a "New session" button starts on: the last one used if online, else the first online. */
export function newSessionHost(
  hosts: HostView[],
  selected: Selection | null,
): HostView | undefined {
  const online = hosts.filter((host) => host.status === "online");
  return online.find((host) => host.id === selected?.hostId) ?? online[0];
}
