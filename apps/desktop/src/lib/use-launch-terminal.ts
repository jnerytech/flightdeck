import { useEffect, useState } from "react";
import type { AppStore } from "./app-store.ts";

/** The live terminal of the host that launched this session ("Claude aqui"), if there is one. */
export function useLaunchTerminal(store: AppStore, hostId: string, launchId: string | null) {
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const embedded = store.embeddedTerminal(hostId);
  useEffect(() => {
    if (!launchId || !embedded) return;
    let alive = true;
    store
      .terminalHost(hostId)
      .list()
      .then(
        (terminals) => {
          const found = terminals.find((t) => t.launchId === launchId && t.exitCode === null);
          if (alive) setTerminalId(found?.terminalId ?? null);
        },
        () => {},
      );
    return () => {
      alive = false;
    };
  }, [store, hostId, launchId, embedded]);
  return launchId ? terminalId : null;
}
