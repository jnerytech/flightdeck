import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { T } from "@/i18n/index";
import type { HostView } from "@/lib/app-store";
import { hostsBanner } from "@/lib/host-status";
import { HostStatusBadge } from "./host-status-badge";

/**
 * The list's strip for hosts that are not online: one compact line ("2 hosts com problema") that
 * opens into the ones down and the ones reconnecting; their sessions stay in the list.
 */
export function HostsBanner(props: { hosts: HostView[]; t: T }) {
  const { down, reconnecting } = hostsBanner(props.hosts);
  const [open, setOpen] = useState(false);
  const total = down.length + reconnecting.length;
  if (total === 0) return null;
  const { t } = props;
  return (
    <div
      role="status"
      aria-label={t("hosts.bannerLabel")}
      className="mb-3 flex flex-col gap-1 rounded-md border border-status-needs-you/40 px-2 py-1 text-sm"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-6 items-center gap-2 text-left font-medium text-status-needs-you focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
        {t("hosts.problems", { n: total })}
      </button>
      {open && (
        <>
          {down.length > 0 && (
            <p className="font-medium text-status-error">{t("hosts.down", { n: down.length })}</p>
          )}
          {reconnecting.length > 0 && (
            <p className="font-medium text-status-needs-you">
              {t("hosts.reconnecting", { n: reconnecting.length })}
            </p>
          )}
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {[...down, ...reconnecting].map((host) => (
              <li key={host.id} className="flex items-center gap-2">
                <span>{host.name}</span>
                <HostStatusBadge status={host.status} t={t} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
