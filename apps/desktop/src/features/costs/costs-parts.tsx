import type { CostsStatus } from "@flightdeck/protocol";
import { ALL_CLIENTS } from "@/features/clients/index.ts";
import { useT } from "@/i18n/context";
import { InlineNotice } from "@/shared/feedback/index.ts";
import { Panel } from "@/shared/layout/index.ts";
import { usd } from "./domain/costs.ts";

/** A breakdown as a two-column table. */
export function Breakdown(
  props: Readonly<{
    name: string;
    /** `id` tells rows apart when two share a label (two projects in folders of the same name). */
    rows: Array<{ id?: string; label: string; costUsd: number }>;
  }>,
) {
  const t = useT();
  return (
    <section aria-label={props.name}>
      <Panel title={props.name}>
        <table className="w-full text-left text-sm tabular-nums">
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.id ?? row.label} className="border-t first:border-t-0">
                <td className="py-1">{row.label}</td>
                <td className="py-1 text-right">{usd(row.costUsd, t.lang)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </section>
  );
}

type Named = Readonly<{ id: string; name: string }>;

/** The notices above the figures: what the totals leave out or disagree on, and the client in view. */
export function CostsNotices(
  props: Readonly<{
    status: CostsStatus | null;
    acrossHosts: boolean;
    allHosts: readonly Named[];
    hosts: readonly Named[];
    failed: string[];
    selection: string;
    clients: readonly Named[];
  }>,
) {
  const t = useT();
  const { status, acrossHosts, allHosts, hosts, failed, selection, clients } = props;
  return (
    <>
      {status && status.divergences.length > 0 && (
        <InlineNotice>
          {t("costsUi.divergence", {
            models: status.divergences
              .map((d) =>
                t("costsUi.divergenceItem", {
                  model: d.model,
                  computed: usd(d.computedUsd, t.lang),
                  sdk: usd(d.sdkUsd, t.lang),
                }),
              )
              .join("; "),
          })}
        </InlineNotice>
      )}
      {acrossHosts && allHosts.some((h) => !hosts.includes(h)) && (
        <InlineNotice>
          {t("costsUi.hostsSkipped", {
            hosts: allHosts
              .filter((h) => !hosts.includes(h))
              .map((h) => h.name)
              .join(", "),
          })}
        </InlineNotice>
      )}
      {failed.length > 0 && (
        <InlineNotice>
          {t("costsUi.hostsFailed", {
            hosts: failed.map((id) => allHosts.find((h) => h.id === id)?.name ?? id).join(", "),
          })}
        </InlineNotice>
      )}
      {selection !== ALL_CLIENTS && (
        <InlineNotice>
          {t("costsUi.onlyClient", {
            name: clients.find((c) => c.id === selection)?.name ?? t("clients.unassigned"),
          })}
        </InlineNotice>
      )}
      {status && status.telemetryDivergences.length > 0 && (
        <InlineNotice>
          {t("telemetry.divergence", {
            items: status.telemetryDivergences
              .map((d) =>
                t("telemetry.divergenceItem", {
                  session: d.claudeSessionId.slice(0, 8),
                  computed: usd(d.computedUsd, t.lang),
                  telemetry: usd(d.telemetryUsd, t.lang),
                }),
              )
              .join("; "),
          })}
        </InlineNotice>
      )}
    </>
  );
}
