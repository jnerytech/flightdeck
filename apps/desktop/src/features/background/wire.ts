import type { AppKernel } from "../../lib/kernel.ts";
import { type BackgroundCore, BackgroundSlice } from "./store.ts";

/** Builds the background sessions' slice from the store's kernel (#1596): the `bg.*` commands of a host. */
export function wireBackground(
  kernel: AppKernel<ReturnType<BackgroundCore["state"]>>,
  deps: { showTerminal: (hostId: string, terminalId: string) => void },
): BackgroundSlice {
  return new BackgroundSlice({
    state: () => kernel.state(),
    update: (patch) => kernel.update(patch),
    list: (hostId) => kernel.hostCommand(hostId, "bg.list", {}),
    stop: (hostId, id) => kernel.hostCommand(hostId, "bg.stop", { id }),
    respawn: (hostId, id) => kernel.hostCommand(hostId, "bg.respawn", { id }),
    message: (hostId, id, text) => kernel.hostCommand(hostId, "bg.message", { id, text }),
    start: (hostId, payload) => kernel.hostCommand(hostId, "bg.start", payload),
    openTerminal: (hostId, session) =>
      kernel.hostCommand(hostId, "terminal.open", {
        cwd: session.cwd,
        command: ["claude", "attach", session.id],
        cols: 80,
        rows: 24,
      }),
    showTerminal: deps.showTerminal,
  });
}
