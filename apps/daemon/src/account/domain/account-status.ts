import type { AccountState, AccountStatus } from "@flightdeck/protocol";
import type { AccountInfoReading, AuthStatus } from "./readings.ts";

export const LOGIN_COMMAND = "claude auth login";

/** The empty reading a host has before the first read. */
export const EMPTY: AccountState = {
  status: "unknown",
  name: null,
  organization: null,
  plan: null,
  provider: null,
  windows: [],
  readAt: null,
  stale: false,
  error: null,
  source: "status",
  loginCommand: LOGIN_COMMAND,
};

/** What `claude auth status` says about how the host is signed in. */
export function statusOfAuth(auth: AuthStatus): AccountStatus {
  if (auth.loggedIn === false) return "signed_out";
  switch (auth.authMethod) {
    case "claude.ai":
      return "signed_in";
    // An API key, or a token for a gateway: no plan, no windows.
    case "api_key":
    case "oauth_token":
      return "api_key";
    case "third_party":
      return "third_party";
    default:
      return "unknown";
  }
}

/** With no status to go by, what the SDK's account info says. */
export function statusOfInfo(info: AccountInfoReading | null): AccountStatus {
  if (info === null) return "unknown";
  if (info.email !== null) return "signed_in";
  if (info.apiKeySource !== null) return "api_key";
  return info.tokenSource === "none" ? "signed_out" : "unknown";
}
