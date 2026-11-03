/** Why a host name is refused: nothing typed, or another host already has it. */
export type HostNameError = "empty" | "duplicate";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The error of naming host `hostId` as `name` among `hosts`, or null when the name is fine. */
export function hostNameError(
  name: string,
  hosts: Array<{ id: string; name: string }>,
  hostId: string,
): HostNameError | null {
  if (!name.trim()) return "empty";
  return hosts.some((h) => h.id !== hostId && same(h.name, name)) ? "duplicate" : null;
}
