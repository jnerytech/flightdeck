import type { ReactNode } from "react";
import { useT } from "@/i18n/context";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { hostDownReason } from "./domain/host-down-reason.ts";

/**
 * The panels of the Settings tab that act on the host, off while the host is not online (#3870).
 * One native disabled fieldset covers every control inside, so no panel checks the status itself;
 * the line under it says why, and that the values shown are the last ones the host reported,
 * with the time. `live` keeps the panels on for a state where they still work (a daemon that is
 * too old can still be updated).
 */
export function HostGate(
  props: Readonly<{ store: AppStore; host: HostView; live?: boolean; children: ReactNode }>,
) {
  const t = useT();
  const { store, host } = props;
  const off = host.status !== "online" && props.live !== true;
  return (
    // `data-gate`: the group's jump row counts what is inside the fieldset, not this wrapper.
    <div data-gate="" className="contents">
      <fieldset disabled={off} className="peer contents">
        {props.children}
      </fieldset>
      {off && (
        // Hidden while the panels inside render nothing (a host without that feature).
        <p className="text-muted-foreground text-xs peer-empty:hidden">
          {hostDownReason(host.status, host.name, t)}
          {host.hostInfo &&
            ` ${t("hostPage.asOf", { when: store.formatWhen(new Date(host.infoAt).toISOString()) })}`}
        </p>
      )}
    </div>
  );
}
