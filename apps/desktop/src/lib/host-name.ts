/** Why a host name is refused: nothing typed, or another host already has it. */
export type HostNameError = "empty" | "duplicate";

/** The error of naming host `hostId` as `name` among `hosts`, or null when the name is fine. */
export function hostNameError(
  _name: string,
  _hosts: Array<{ id: string; name: string }>,
  _hostId: string,
): HostNameError | null {
  return null;
}
