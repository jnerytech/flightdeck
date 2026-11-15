import { useEffect, useState } from "react";

/** What the hook reads of the app store: whether a host embeds terminals, and the terminals it lists. */
interface LaunchStore {
  terminals: {
    embedded(hostId: string): boolean;
    host(hostId: string): {
      list(): Promise<{ launchId?: string | null; exitCode: number | null; terminalId: string }[]>;
    };
  };
}

/** The live terminal of the host that launched this session ("Claude aqui"), if there is one. */
export function useLaunchTerminal(store: LaunchStore, hostId: string, launchId: string | null) {
  const [terminalId, setTerminalId] = useState<string | null>(null);
  // Asked only for a session with a launch: a page without one needs nothing of the host's terminal.
  const embedded = launchId ? store.terminals.embedded(hostId) : false;
  useEffect(() => {
    if (!launchId || !embedded) return;
    let alive = true;
    store.terminals
      .host(hostId)
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
