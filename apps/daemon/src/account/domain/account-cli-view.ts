/**
 * Issue #3703: what `flightdeckd account get|refresh|watch` say, as pure rules over the answers of the daemon. The
 * daemon calls and the stream stay in `account/account-cli.ts`.
 */
import type { AccountState } from "@flightdeck/protocol";

export interface AccountCliArgs {
  action: "get" | "refresh" | "watch";
  json?: boolean;
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** Who is signed in (or why nobody is), as the first line. */
function headline(state: AccountState): string {
  switch (state.status) {
    case "signed_in":
      return [
        `signed in as ${state.name ?? "an unnamed account"}`,
        state.organization,
        state.plan,
        state.provider,
      ]
        .filter((part) => part !== null)
        .join("  ");
    case "signed_out":
      return `signed out of Claude on this host: run \`${state.loginCommand}\` there to sign in`;
    case "api_key":
      return "this host uses an API key, so there is no plan account";
    case "third_party":
      return `this host uses ${state.provider ?? "another provider"}, so there is no plan account`;
    default:
      return "the account of this host is not known";
  }
}

/** The headline, one line per plan window, a warning when the last read failed, and when it was read. */
export function accountLines(state: AccountState): string[] {
  return [
    headline(state),
    ...state.windows.map((w) =>
      [
        w.window,
        w.utilization === null ? "unknown" : percent(w.utilization),
        w.status,
        ...(w.resetsAt === null ? [] : [`resets ${w.resetsAt}`]),
      ].join("  "),
    ),
    ...(state.stale
      ? [`the last read failed (${state.error ?? "unknown"}): this is the previous reading`]
      : []),
    state.readAt === null ? "not read yet" : `read ${state.readAt}`,
  ];
}

/** The line `watch` prints for an update: the lines of `account get`, on one line. */
export const accountWatchLine = (state: AccountState): string => accountLines(state).join(" | ");
