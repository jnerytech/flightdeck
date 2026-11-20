import type { ServerMessage } from "@flightdeck/protocol";
import type { HostConnectionOptions } from "./host-connection-options.ts";

/** Hands a pushed message to the callback that listens for its type; false for the ones the connection handles itself (ping, ack). */
export function routeFrame(o: HostConnectionOptions, message: ServerMessage): boolean {
  switch (message.type) {
    case "event":
      o.onEvent(message);
      return true;
    case "card.updated":
      o.onCardUpdated?.(message.card);
      return true;
    case "history.changed":
      o.onHistoryChanged?.(message);
      return true;
    case "askpass.request":
      o.onAskpass?.(message);
      return true;
    case "vault.request":
      o.onVaultRequest?.(message);
      return true;
    case "vault.used":
      o.onVaultUsed?.(message);
      return true;
    case "vault.alert":
      o.onVaultAlert?.(message);
      return true;
    case "teams.updated":
      o.onTeams?.(message);
      return true;
    case "messaging.alert":
      o.onMessagingAlert?.(message);
      return true;
    case "watch.updated":
      o.onWatch?.(message);
      return true;
    case "messages.relay":
    case "messages.updated":
      o.onMessages?.(message);
      return true;
    case "run.updated":
      o.onRunUpdated?.(message.run);
      return true;
    case "runenv.updated":
      o.onRunEnvUpdated?.(message.state);
      return true;
    case "quota.updated":
      o.onQuotaUpdated?.({ windows: message.windows, pauseAt: message.pauseAt });
      return true;
    case "account.updated": {
      const { type: _type, ...state } = message;
      o.onAccountUpdated?.(state);
      return true;
    }
    case "approval.enrolled":
    case "approval.revoked":
      o.onApproval?.(message);
      return true;
    case "budget.updated":
      o.onBudgetUpdated?.(message);
      return true;
    case "changes.updated":
      o.onChangesUpdated?.(message);
      return true;
    case "terminal.data":
    case "terminal.exited":
    case "terminal.resync":
      o.onTerminal?.(message);
      return true;
    case "external.updated":
    case "external.permission":
      o.onExternal?.(message);
      return true;
    default:
      return false;
  }
}
