import { Button } from "@/components/ui/button";
import type { AppStore } from "../lib/app-store.ts";
import type { TerminalTarget } from "../lib/terminal.ts";

/**
 * "Abrir no terminal" for a session, card or project: opens one on this machine, or copies the
 * command when the host is elsewhere. `name` tells several buttons apart in a list.
 */
export function TerminalButton(props: {
  store: AppStore;
  hostId: string;
  target: TerminalTarget;
  name?: string;
}) {
  const { store, hostId, target, name } = props;
  const launch = store.terminalLaunch(hostId, target);
  if (!launch) return null;
  const label =
    launch.kind === "spawn"
      ? name
        ? `Abrir ${name} no terminal`
        : "Abrir no terminal"
      : name
        ? `Copiar comando de ${name}`
        : "Copiar comando";
  return (
    <Button variant="outline" size="sm" onClick={() => void store.openInTerminal(hostId, target)}>
      {label}
    </Button>
  );
}
