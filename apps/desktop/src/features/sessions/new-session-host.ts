import type { Selection } from "./domain/selection.ts";

/** The host a "New session" button starts on: the last one used if online, else the first online. */
export function newSessionHost<H extends { id: string; status: string }>(
  hosts: readonly H[],
  selected: Selection | null,
): H | undefined {
  const online = hosts.filter((host) => host.status === "online");
  return online.find((host) => host.id === selected?.hostId) ?? online[0];
}
