import type { T } from "@/i18n/index";
import type { HostView } from "@/lib/app-store";
import { hostsBanner } from "@/lib/host-status";
import { HostStatusBadge } from "./host-status-badge";

/** The hub's strip: "N hosts offline" (and the ones reconnecting), instead of hiding their sessions. */
export function HostsBanner(props: { hosts: HostView[]; t: T }) {
  const { down, reconnecting } = hostsBanner(props.hosts);
  if (down.length + reconnecting.length === 0) return null;
  const { t } = props;
  return (
    <div
      role="status"
      aria-label={t("hosts.bannerLabel")}
      className="mb-3 flex flex-col gap-1 rounded-lg border border-status-needs-you/40 p-3 text-sm"
    >
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
    </div>
  );
}
