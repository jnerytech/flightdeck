import type { RoiSummaryResult } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { Key } from "@/i18n/index";
import type { AppStore } from "@/lib/app-store";
import { usd } from "@/lib/costs";
import { csvOf, type RoiColumn, rowsFrom, sortRows, totalsOf } from "@/lib/roi-table";
import { useStoreSlice } from "@/lib/use-store";

const COLUMNS: RoiColumn[] = [
  "project",
  "cost",
  "cards",
  "prs",
  "costPerCard",
  "costPerPr",
  "hours",
  "value",
  "roi",
];
const DASH = "—";
const money = (n: number | null) => (n === null ? DASH : usd(n));
const REFRESH_MS = 30_000;

/** The `aria-sort` of a column header: ascending or descending when it is the sorted one. */
function ariaSort(
  sort: { column: string; direction: "asc" | "desc" } | null | undefined,
  column: string,
): "ascending" | "descending" | undefined {
  if (sort?.column !== column) return undefined;
  return sort.direction === "asc" ? "ascending" : "descending";
}

/**
 * Phase 36: the project table of the Costs screen: what each project of the scope delivered for
 * what it cost. Sortable by every column; a figure that cannot be computed shows a dash, and the
 * footer adds up the rows.
 */
export function RoiTable(props: {
  store: AppStore;
  hostIds: string[];
  from: string;
  to: string;
  /** The client selection of the screen. */
  selection: string;
  projectName: (projectKey: string) => string;
}) {
  const { store, from, to, selection, projectName } = props;
  const t = useT();
  // The money is the app's own settings: a saved rate shows at once.
  useStoreSlice(store, ["roiRevision"]);
  const [answers, setAnswers] = useState<Array<{ hostId: string; result: RoiSummaryResult }>>([]);
  const [sort, setSort] = useState<{ column: RoiColumn; direction: "asc" | "desc" } | null>(null);
  const hostKey = props.hostIds.join("|");

  useEffect(() => {
    let live = true;
    const load = () =>
      void store.roiSummaries(from, to === store.today() ? store.roiToday() : to).then((all) => {
        if (live) setAnswers(all.filter((a) => hostKey.split("|").includes(a.hostId)));
      });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [store, from, to, hostKey]);

  const scope = store.clientScope();
  const rows = rowsFrom({
    summaries: answers,
    inScope: (key) => scope.includes(selection, key),
    moneyOf: (key) => store.roiMoneyOf(key),
    nameOf: (key, name) => projectName(key) || name,
  });
  const shown = sort ? sortRows(rows, sort.column, sort.direction) : sortRows(rows, "cost", "desc");
  const totals = totalsOf(rows);
  const label = (column: RoiColumn) => t(`roiUi.table.${column}` as Key);
  const click = (column: RoiColumn) =>
    setSort(
      sort?.column === column
        ? { column, direction: sort.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" },
    );

  const exportCsv = async () => {
    const text = csvOf(shown, [...COLUMNS.map(label), t("roiUi.table.derivation")], (row) =>
      row.figures.derivation.map((d) => t(d.key as Key, d.vars)).join("; "),
    );
    await store.saveFile(`roi-${from}_${to}.csv`, text);
  };

  return (
    <section aria-label={t("roiUi.tableTitle")} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium text-sm">{t("roiUi.tableTitle")}</h2>
        {rows.length > 0 && (
          <Button variant="outline" size="sm" onClick={exportCsv}>
            {t("roiUi.table.exportCsv")}
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("roiUi.table.empty")}</p>
      ) : (
        <table aria-label={t("roiUi.tableTitle")} className="w-full text-left text-sm tabular-nums">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column}
                  scope="col"
                  aria-sort={ariaSort(sort, column)}
                  className="py-1 pr-3 font-medium"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto px-0"
                    onClick={() => click(column)}
                  >
                    {label(column)}
                  </Button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.key} className="border-t">
                <th scope="row" className="py-1 pr-3 font-normal">
                  {row.name}
                </th>
                <td className="pr-3">{usd(row.figures.costUsd)}</td>
                <td className="pr-3">{row.figures.cards}</td>
                <td className="pr-3">{row.figures.prsMerged}</td>
                <td className="pr-3">{money(row.figures.costPerCard)}</td>
                <td className="pr-3">{money(row.figures.costPerPr)}</td>
                <td className="pr-3">{row.figures.hours}</td>
                <td className="pr-3">{money(row.figures.valueUsd)}</td>
                <td className="pr-3">
                  {row.figures.roi === null ? DASH : row.figures.roi.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-medium">
              <th scope="row" className="py-1 pr-3 text-left">
                {t("roiUi.table.total")}
              </th>
              <td className="pr-3">{usd(totals.costUsd)}</td>
              <td className="pr-3">{totals.cards}</td>
              <td className="pr-3">{totals.prsMerged}</td>
              <td className="pr-3">{money(totals.costPerCard)}</td>
              <td className="pr-3">{money(totals.costPerPr)}</td>
              <td className="pr-3">{totals.hours}</td>
              <td className="pr-3">{money(totals.valueUsd)}</td>
              <td className="pr-3">{totals.roi === null ? DASH : totals.roi.toFixed(1)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  );
}
