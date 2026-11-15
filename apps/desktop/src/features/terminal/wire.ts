import type { AppKernel } from "../../lib/kernel.ts";
import type { Tabs } from "../tabs/index.ts";
import { type ClosingTerminal, type TerminalsCore, TerminalsSlice } from "./store.ts";

/** The app's state as the terminals read it: the hosts, the terminal env and the waiting close. */
interface TerminalsState {
  hosts: ReturnType<TerminalsCore["hosts"]>;
  terminalEnv: ReturnType<TerminalsCore["terminalEnv"]>;
  closingTerminal: ClosingTerminal | null;
}

/**
 * Builds the terminals' slice from the store's kernel (#1596): a host's `terminal.*` commands and
 * the waiting close. The tabs, the clipboard, the local terminal program and the error text stay
 * named deps; `areas` are the tab areas a waiting close can be in (the current host's, and the
 * first area of each other host, for a tab of the all-hosts row).
 */
export function wireTerminals(
  kernel: AppKernel<TerminalsState>,
  deps: Pick<TerminalsCore, "showTab" | "copyText" | "spawn"> & {
    areas(): readonly Tabs[];
    describeError(error: unknown): string;
  },
): TerminalsSlice {
  return new TerminalsSlice({
    hosts: () => kernel.state().hosts,
    terminalEnv: () => kernel.state().terminalEnv,
    dispatch: (hostId, type, payload) => kernel.dispatch(hostId, type, payload),
    open: (hostId, payload) => kernel.hostCommand(hostId, "terminal.open", payload),
    close: (hostId, terminalId, kill) =>
      kernel.hostCommand(hostId, "terminal.close", { terminalId, kill }),
    showTab: deps.showTab,
    closing: () => kernel.state().closingTerminal,
    setClosing: (closingTerminal) => kernel.update({ closingTerminal }),
    closingTab: (closing) => {
      const area = deps.areas().find((candidate) => candidate.id === closing.areaId);
      const route = area?.tabs.find((tab) => tab.id === closing.tabId)?.router.current;
      if (!area || route?.name !== "terminal") return null;
      return {
        hostId: route.host,
        terminalId: route.terminalId,
        closeTab: () => area.close(closing.tabId),
      };
    },
    copyText: deps.copyText,
    spawn: deps.spawn,
    spawnFailed: (error) =>
      kernel.fail(
        error,
        kernel.t()("messages.terminalFailed", { error: deps.describeError(error) }),
      ),
  });
}
