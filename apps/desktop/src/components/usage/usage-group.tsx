import type { UsageGroup, UsageHistoryTarget } from "../../lib/usage-rows.ts";

interface Row {
  day: string;
  projectKey: string;
  costUsd: number;
  tokens: number | [input: number, output: number];
  turns: string | null;
}

/** One project of the host's usage table: its name and total, then its days (each opens History). */
export function UsageGroupRows(props: {
  group: UsageGroup<Row>;
  /** How many columns the table has, for the project's header cell. */
  columns: number;
  total: string;
  format: { cost(usd: number): string; number(n: number): string };
  onOpenHistory?(filter: UsageHistoryTarget): void;
}) {
  const { group, format } = props;
  return (
    <tbody>
      <tr className="border-t">
        <th
          scope="rowgroup"
          colSpan={props.columns}
          title={group.projectKey}
          className="py-1 text-left font-semibold"
        >
          {group.label}
          <span className="pl-4 font-normal tabular-nums">{props.total}</span>
        </th>
      </tr>
      {group.rows.map((row) => (
        <tr key={row.day}>
          <td className="whitespace-nowrap py-1 pl-4">
            <button
              type="button"
              className="underline-offset-2 hover:underline"
              onClick={() =>
                props.onOpenHistory?.({
                  ...(group.cwd ? { cwd: group.cwd } : { projectKey: group.projectKey }),
                  day: row.day,
                })
              }
            >
              {row.day}
            </button>
          </td>
          <td className="whitespace-nowrap py-1 pl-4 text-right">{format.cost(row.costUsd)}</td>
          <td className="whitespace-nowrap py-1 pl-4 text-right">
            {Array.isArray(row.tokens)
              ? row.tokens.map(format.number).join(" / ")
              : format.number(row.tokens)}
          </td>
          {row.turns !== null && (
            <td className="whitespace-nowrap py-1 pl-4 text-right">{row.turns}</td>
          )}
        </tr>
      ))}
    </tbody>
  );
}
