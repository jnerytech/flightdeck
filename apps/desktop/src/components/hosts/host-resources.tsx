import type { ResourceRow, ResourcesSnapshot } from "@flightdeck/protocol";
import { TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Bar } from "@/components/layout/bar";
import { Panel } from "@/components/layout/panel";
import { useT } from "@/i18n/context";
import { formatBytes, formatDuration } from "../../i18n/format.ts";
import type { T } from "../../i18n/index.ts";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { basename } from "../../lib/paths.ts";
import { hasFeature } from "../../lib/version.ts";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";

/** How often a panel on screen reads the host again. */
export const RESOURCES_EVERY_MS = 5000;

type Level = "ok" | "high" | "critical";

/** 80% is high and 90% critical; they are said in words as well as drawn. */
export function levelOf(percent: number): Level {
  return percent >= 90 ? "critical" : percent >= 80 ? "high" : "ok";
}

function Meter(props: {
  slot: string;
  label: string;
  used: number;
  total: number;
  t: T;
  lang: "en" | "pt-BR";
}) {
  const { t } = props;
  const ratio = props.total > 0 ? props.used / props.total : 0;
  const percent = Math.round(ratio * 100);
  const level = levelOf(percent);
  return (
    <div data-slot={props.slot} data-level={level} className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{props.label}</span>
        <span className="tabular-nums">{`${percent}%`}</span>
        {level !== "ok" && (
          <span className="inline-flex items-center gap-1 text-status-needs-you text-xs">
            <TriangleAlert aria-hidden="true" className="size-3" />
            {t(level === "critical" ? "resources.critical" : "resources.high")}
          </span>
        )}
      </div>
      <Bar ratio={ratio} />
      <p className="text-muted-foreground text-xs">
        {t("resources.used", {
          used: formatBytes(props.used, props.lang),
          total: formatBytes(props.total, props.lang),
        })}
      </p>
    </div>
  );
}

function Row(props: { row: ResourceRow; t: T; lang: "en" | "pt-BR" }) {
  const { row, t, lang } = props;
  return (
    <tr data-slot="resources-row" data-id={row.id} className="border-t">
      <td className="py-1 pr-3">
        <span className="font-medium">{row.name ?? row.id}</span>
        <span className="ml-2 text-muted-foreground text-xs">
          {t(`resources.kinds.${row.kind}`)}
        </span>
      </td>
      <td className="py-1 pr-3">{row.cwd ? basename(row.cwd) : "—"}</td>
      <td className="py-1 pr-3 text-right tabular-nums">{formatBytes(row.rssBytes, lang)}</td>
      <td className="py-1 pr-3 text-right tabular-nums">
        {row.cpuPercent === null
          ? "—"
          : `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(row.cpuPercent)}%`}
      </td>
      <td className="py-1 text-muted-foreground text-xs">{row.names.join(", ")}</td>
    </tr>
  );
}

/**
 * What the host's work costs it: memory and disk, each session and terminal by memory, and the
 * processes the daemon started that no session owns (ended after a confirmation). It reads only
 * while it is on screen, and only a host that announces `resources`; the numbers are names and
 * sizes, never a command line.
 */
export function HostResources(props: {
  store: AppStore;
  host: HostView;
  /** The panel is on screen: it reads only then. */
  active?: boolean;
  /** Test seam: how often it reads, in ms. */
  everyMs?: number;
}) {
  const { store, host } = props;
  const t = useT();
  const lang = store.i18n.lang;
  const [snap, setSnap] = useState<ResourcesSnapshot | null>(null);
  const [ending, setEnding] = useState<ResourcesSnapshot["orphans"][number] | null>(null);
  const offered = hasFeature(host.hostInfo?.features, "resources", false);
  const reading = offered && host.status === "online" && props.active !== false;
  const read = useCallback(async () => {
    const next = await store.hostCommand(host.id, "resources.get", {});
    if (next) setSnap(next);
  }, [store, host.id]);
  useEffect(() => {
    if (!reading) return;
    void read();
    const timer = setInterval(() => void read(), props.everyMs ?? RESOURCES_EVERY_MS);
    return () => clearInterval(timer);
  }, [reading, read, props.everyMs]);
  if (!offered) return null;
  const rows = [...(snap?.rows ?? [])].sort((a, b) => b.rssBytes - a.rssBytes);
  return (
    <Panel title={t("resources.title")} label={t("resources.title")} slot="host-resources">
      {snap && (
        <>
          <Meter
            slot="resources-memory"
            label={t("resources.memory")}
            used={snap.memory.totalBytes - snap.memory.freeBytes}
            total={snap.memory.totalBytes}
            t={t}
            lang={lang}
          />
          {snap.disk && (
            <Meter
              slot="resources-disk"
              label={t("resources.disk")}
              used={snap.disk.totalBytes - snap.disk.freeBytes}
              total={snap.disk.totalBytes}
              t={t}
              lang={lang}
            />
          )}
          {snap.loadPercent !== null && (
            <p className="text-muted-foreground text-xs">
              {t("resources.load", { n: snap.loadPercent })}
            </p>
          )}
          {!snap.measured ? (
            <p className="text-muted-foreground text-sm">{t("resources.notMeasured")}</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("resources.empty")}</p>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">{t("resources.list")}</caption>
              <thead className="text-left text-muted-foreground text-xs">
                <tr>
                  <th scope="col" className="pr-3 font-normal">
                    {t("resources.session")}
                  </th>
                  <th scope="col" className="pr-3 font-normal">
                    {t("resources.project")}
                  </th>
                  <th scope="col" className="pr-3 text-right font-normal">
                    {t("resources.memoryCol")}
                  </th>
                  <th scope="col" className="pr-3 text-right font-normal">
                    {t("resources.cpu")}
                  </th>
                  <th scope="col" className="font-normal">
                    {t("resources.programs")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Row key={`${row.kind}/${row.id}`} row={row} t={t} lang={lang} />
                ))}
              </tbody>
            </table>
          )}
          {snap.orphans.length > 0 && (
            <section aria-label={t("resources.orphans")} className="flex flex-col gap-2">
              <h4 className="font-medium text-sm">{t("resources.orphans")}</h4>
              <p className="text-muted-foreground text-xs">{t("resources.orphansHelp")}</p>
              <ul className="flex flex-col gap-1">
                {snap.orphans.map((orphan) => (
                  <li
                    key={orphan.pid}
                    data-slot="resources-orphan"
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span>
                      {t("resources.orphanLine", {
                        name: orphan.name,
                        pid: orphan.pid,
                        age: formatDuration(orphan.ageSec * 1000, t),
                        memory: formatBytes(orphan.rssBytes, lang),
                      })}
                    </span>
                    <ActionButton size="sm" variant="outline" onClick={() => setEnding(orphan)}>
                      {t("resources.end")}
                    </ActionButton>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {ending && (
        <ConfirmDialog
          message={t("resources.endMessage", { pid: ending.pid, name: ending.name })}
          confirmLabel={t("resources.endTitle")}
          destructive
          onCancel={() => setEnding(null)}
          onConfirm={() => {
            const { pid, startTicks } = ending;
            setEnding(null);
            void store
              .hostCommand(host.id, "resources.endOrphan", { pid, startTicks })
              .then(() => read());
          }}
        />
      )}
    </Panel>
  );
}
