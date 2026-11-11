import { Panel } from "@/components/layout/panel";
import { Stack } from "@/components/layout/stack";
import { QuotaBarList } from "@/components/shell/quota-bars";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { onSubscription } from "@/lib/quota";
import { useStoreSlice } from "@/lib/use-store";

const LEAD_KEYS = ["quota", "account", "hosts"] as const;

/**
 * What leads the Costs screen on a subscription (issue #1248): the plan quota of each host in the
 * scope, since the dollars below are an API-equivalent estimate that is not charged. Nothing for a
 * host on an API key, whose dollars are what is charged.
 */
export function CostsQuotaLead(props: Readonly<{ store: AppStore; hostIds: string[] }>) {
  const { store, hostIds } = props;
  const t = useT();
  const state = useStoreSlice(store, LEAD_KEYS);
  const shown = state.hosts.filter(
    (h) => hostIds.includes(h.id) && onSubscription(state.quota[h.id], state.account[h.id]),
  );
  if (shown.length === 0) return null;
  return (
    <section aria-label={t("costsUi.quotaLead")}>
      <Panel title={t("costsUi.quotaLead")}>
        <Stack gap={4}>
          {shown.map((host) => (
            <Stack key={host.id} gap={2} label={t("quota.region", { host: host.name })}>
              {shown.length > 1 && <h3 className="font-semibold text-sm">{host.name}</h3>}
              <QuotaBarList store={store} host={host} quota={state.quota[host.id]} />
            </Stack>
          ))}
        </Stack>
      </Panel>
    </section>
  );
}
