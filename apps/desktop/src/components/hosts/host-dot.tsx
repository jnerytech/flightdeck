/** A host's color as a dot, never the only sign of the host: its name always stands next to it. */
export function HostDot(_props: Readonly<{ hostId: string; className?: string }>) {
  return <span aria-hidden="true" data-host-dot="0" />;
}
