import type { WorktreeItem, WorktreesResult } from "@flightdeck/protocol";
import { TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { formatBytes } from "../../i18n/format.ts";
import type { Key, T } from "../../i18n/index.ts";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";

type Filter = "all" | "suggested" | "protected" | "noCard";
type Sort = "age" | "size";

const FILTERS: Filter[] = ["all", "suggested", "protected", "noCard"];

/** A disk with less than this share free is warned about. */
const LOW_DISK = 0.1;

const keep: Record<Filter, (item: WorktreeItem) => boolean> = {
  all: () => true,
  suggested: (item) => item.suggested,
  protected: (item) => item.blockers.length > 0,
  noCard: (item) => item.cardId === null,
};

/** Why a worktree is kept, in words: the blockers, with the unpushed count. */
export function reasonText(item: Pick<WorktreeItem, "blockers" | "unpushed">, t: T): string {
  return item.blockers
    .map((blocker) =>
      blocker === "unpushed"
        ? t(item.unpushed === 1 ? "worktrees.reasons.unpushedOne" : "worktrees.reasons.unpushed", {
            n: item.unpushed,
          })
        : t(`worktrees.reasons.${blocker}` as Key),
    )
    .join("; ");
}

function Row(props: {
  item: WorktreeItem;
  t: T;
  lang: "en" | "pt-BR";
  checked: boolean;
  onToggle(): void;
}) {
  const { item, t, lang } = props;
  const name = item.branch ?? item.path;
  const protectedRow = item.blockers.length > 0;
  return (
    <li
      data-slot="worktree-row"
      data-branch={item.branch}
      className="flex flex-col gap-1 border-t py-2 text-sm"
    >
      <label className="hit-control flex min-w-0 items-center gap-2">
        <input
          type="checkbox"
          aria-label={t("worktrees.select", { name })}
          checked={props.checked}
          disabled={protectedRow}
          onChange={props.onToggle}
        />
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        {item.suggested && (
          <span className="rounded bg-muted px-1 text-xs">{t("worktrees.suggestedBadge")}</span>
        )}
        <span className="shrink-0 tabular-nums">
          {item.sizeBytes === null ? t("worktrees.unknown") : formatBytes(item.sizeBytes, lang)}
        </span>
      </label>
      <p className="flex flex-wrap gap-x-3 text-muted-foreground text-xs">
        <span>{item.projectName}</span>
        {item.cardTitle && <span>{item.cardTitle}</span>}
        <span>
          {Math.floor(item.idleDays) === 1
            ? t("worktrees.idleOne")
            : t("worktrees.idle", { n: Math.floor(item.idleDays) })}
        </span>
      </p>
      {protectedRow && (
        <p className="text-muted-foreground text-xs">
          {t("worktrees.kept", { reason: reasonText(item, t) })}
        </p>
      )}
    </li>
  );
}

/**
 * The cards' worktrees on a host: how big each is, whether it is safe to remove, and a removal
 * that asks first, names each branch, and never reaches one with uncommitted changes, unpushed
 * commits or a live session (the daemon looks again at the moment). Read on open and on demand: a
 * size scan is not something to repeat every few seconds.
 */
export function HostWorktrees(props: { store: AppStore; host: HostView }) {
  const { store, host } = props;
  const t = useT();
  const lang = store.i18n.lang;
  const [data, setData] = useState<WorktreesResult | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("age");
  const [picked, setPicked] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string[]>([]);
  const offered = hasFeature(host.hostInfo?.features, "worktrees", false);
  const reading = offered && host.status === "online";
  const read = useCallback(async () => {
    const next = await store.hostCommand(host.id, "worktree.list", {});
    if (next) setData(next);
  }, [store, host.id]);
  useEffect(() => {
    if (reading) void read();
  }, [reading, read]);
  if (!offered) return null;

  const all = data?.worktrees ?? [];
  const shown = all
    .filter(keep[filter])
    .sort((a, b) =>
      sort === "size" ? (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1) : b.idleDays - a.idleDays,
    );
  const removable = all.filter((item) => item.blockers.length === 0);
  const chosen = removable.filter((item) => picked.includes(item.path));
  const toggle = (path: string) =>
    setPicked((now) => (now.includes(path) ? now.filter((p) => p !== path) : [...now, path]));
  const low = (data?.disks ?? []).find(
    (d) => d.totalBytes > 0 && d.freeBytes / d.totalBytes < LOW_DISK,
  );
  const count = all.length;
  const removeLabel =
    chosen.length === 0
      ? t("worktrees.removeNone")
      : chosen.length === 1
        ? t("worktrees.removeOne")
        : t("worktrees.remove", { n: chosen.length });
  const reasonOf = (reason: string, detail?: string) =>
    reason === "failed" && detail
      ? `${t("worktrees.reasons.failed")}: ${detail}`
      : t(`worktrees.reasons.${reason}` as Key, { n: 0 });

  const remove = async () => {
    const result = await store.hostCommand(host.id, "worktree.remove", {
      items: chosen.map((item) => ({ projectId: item.projectId, path: item.path })),
    });
    setPicked([]);
    if (result) {
      const freed = result.removed.reduce((sum, r) => sum + (r.freedBytes ?? 0), 0);
      const lines = [
        result.removed.length === 0
          ? ""
          : freed > 0
            ? t("worktrees.freed", { size: formatBytes(freed, lang) })
            : t("worktrees.removedNoSize", { n: result.removed.length }),
        ...result.kept.map((k) =>
          t("worktrees.keptItem", {
            branch: all.find((i) => i.path === k.path)?.branch ?? k.path,
            reason: reasonOf(k.reason, k.detail),
          }),
        ),
      ].filter(Boolean);
      setNotice(lines);
    }
    await read();
  };

  return (
    <Panel title={t("worktrees.title")} label={t("worktrees.title")} slot="host-worktrees">
      {data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {count === 1 ? t("worktrees.countOne") : t("worktrees.count", { n: count })}
            </span>
            <Button size="sm" variant="outline" onClick={() => void read()}>
              {t("worktrees.scan")}
            </Button>
          </div>
          {low && (
            <p className="flex items-center gap-1 text-sm text-status-needs-you">
              <TriangleAlert aria-hidden="true" className="size-4" />
              {t("worktrees.lowDisk", {
                free: formatBytes(low.freeBytes, lang),
                total: formatBytes(low.totalBytes, lang),
              })}
            </p>
          )}
          <fieldset
            aria-label={t("worktrees.filters")}
            className="m-0 flex flex-wrap gap-2 border-0 p-0"
          >
            {FILTERS.map((name) => (
              <Button
                key={name}
                size="sm"
                variant="outline"
                aria-pressed={filter === name}
                onClick={() => setFilter(name)}
              >
                {t(`worktrees.${name}` as Key)}
              </Button>
            ))}
            <label className="flex items-center gap-1 text-xs">
              {t("worktrees.sort")}
              <select
                aria-label={t("worktrees.sort")}
                value={sort}
                onChange={(e) => setSort(e.target.value as Sort)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="age">{t("worktrees.sortAge")}</option>
                <option value="size">{t("worktrees.sortSize")}</option>
              </select>
            </label>
          </fieldset>
          {count === 0 ? (
            <p className="text-muted-foreground text-sm">{t("worktrees.empty")}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPicked(removable.filter((i) => i.suggested).map((i) => i.path))}
                >
                  {t("worktrees.selectSuggested")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPicked(removable.map((i) => i.path))}
                >
                  {t("worktrees.selectAll")}
                </Button>
              </div>
              <ul className="flex flex-col">
                {shown.map((item) => (
                  <Row
                    key={item.path}
                    item={item}
                    t={t}
                    lang={lang}
                    checked={picked.includes(item.path)}
                    onToggle={() => toggle(item.path)}
                  />
                ))}
              </ul>
              <ActionButton
                variant="destructive"
                size="sm"
                className="self-start"
                disabled={chosen.length === 0}
                disabledReason={t("worktrees.removeNeeds")}
                onClick={() => setConfirming(true)}
              >
                {removeLabel}
              </ActionButton>
            </>
          )}
        </>
      )}
      {notice.length > 0 && (
        <output className="flex flex-col gap-1 text-sm">
          {notice.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </output>
      )}
      {confirming && (
        <ConfirmDialog
          message={t("worktrees.confirm", {
            names: chosen.map((i) => i.branch ?? i.path).join(", "),
            size: formatBytes(
              chosen.reduce((sum, i) => sum + (i.sizeBytes ?? 0), 0),
              lang,
            ),
          })}
          confirmLabel={t("worktrees.removeConfirm")}
          destructive
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void remove();
          }}
        />
      )}
    </Panel>
  );
}
