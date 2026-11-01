import type { DiffFile, ReviewComment } from "@flightdeck/protocol";
import type { ReactNode } from "react";
import { useT } from "@/i18n/context";
import { cn } from "@/lib/utils";
import { type DiffRow, diffRows, type Selection, selected } from "../lib/review.ts";

type LineRow = Extract<DiffRow, { kind: "line" }>;

/** Whole class names, so Tailwind finds them. */
const TONE = {
  "+": "bg-status-running/10",
  "-": "bg-status-error/10",
  " ": "",
} as const;

/** The number of a line, a button that starts (or, with shift, extends) a comment on it. */
function LineNumber(props: {
  path: string;
  side: ReviewComment["side"];
  line: number;
  picked: boolean;
  onPick(path: string, side: ReviewComment["side"], line: number, extend: boolean): void;
}) {
  const t = useT();
  const key = props.side === "old" ? "changes.commentOldLine" : "changes.commentLine";
  return (
    <button
      type="button"
      aria-label={t(key, { line: props.line, path: props.path })}
      aria-pressed={props.picked}
      className="min-h-6 w-10 shrink-0 select-none px-1 text-right text-muted-foreground tabular-nums hover:text-foreground aria-pressed:text-foreground"
      onClick={(e) => props.onPick(props.path, props.side, props.line, e.shiftKey)}
    >
      {props.line}
    </button>
  );
}

/** One file's diff: its lines numbered and clickable, unified or side by side. */
function FileDiff(props: {
  file: DiffFile;
  mode: "unified" | "split";
  selection: Selection | null;
  onPick(path: string, side: ReviewComment["side"], line: number, extend: boolean): void;
}) {
  const t = useT();
  const { file, selection, onPick } = props;
  const path = file.path;
  const rows = diffRows(file);
  if (file.binary) {
    return <p className="text-muted-foreground text-xs">{t("changes.binaryNote")}</p>;
  }
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-xs">{t("changes.noLines")}</p>;
  }
  const number = (row: LineRow, side: ReviewComment["side"]) => {
    const line = (side === "old" ? row.oldLine : row.newLine) as number;
    return (
      <LineNumber
        path={path}
        side={side}
        line={line}
        picked={selected(selection, path, side, line)}
        onPick={onPick}
      />
    );
  };
  const renderRow = (row: DiffRow, i: number) => {
    if (row.kind === "hunk") {
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are immutable and ordered
        <tr key={i} className="bg-muted text-muted-foreground">
          <td colSpan={props.mode === "split" ? 2 : 1} className="px-2 py-0.5">
            {row.header}
          </td>
        </tr>
      );
    }
    if (props.mode === "unified") {
      return (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are immutable and ordered
        <tr key={i} className={TONE[row.op]}>
          <td className="flex">
            {number(row, row.op === "-" ? "old" : "new")}
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-2">
              {`${row.op}${row.text}`}
            </span>
          </td>
        </tr>
      );
    }
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: rows are immutable and ordered
      <tr key={i}>
        <td className={cn("w-1/2 border-r align-top", row.op === "-" && TONE["-"])}>
          {row.op !== "+" && (
            <div className="flex">
              {row.op === "-" ? number(row, "old") : <span className="w-10 shrink-0" />}
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-2">{row.text}</span>
            </div>
          )}
        </td>
        <td className={cn("w-1/2 align-top", row.op === "+" && TONE["+"])}>
          {row.op !== "-" && (
            <div className="flex">
              {number(row, "new")}
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all px-2">{row.text}</span>
            </div>
          )}
        </td>
      </tr>
    );
  };
  return (
    <table className="w-full table-fixed overflow-hidden rounded-md border font-mono text-xs">
      <tbody>{rows.map(renderRow)}</tbody>
    </table>
  );
}

/** The changes of every file, stacked: each with its numbered lines and the open composer. */
export function DiffView(props: {
  files: DiffFile[];
  mode: "unified" | "split";
  selection: Selection | null;
  onPick(path: string, side: ReviewComment["side"], line: number, extend: boolean): void;
  /** The form to comment on the selection; shown under the file it belongs to. */
  composer: ReactNode;
}) {
  const t = useT();
  return (
    <section
      aria-label={props.mode === "unified" ? t("diff.unifiedLabel") : t("diff.splitLabel")}
      className="flex flex-col gap-4"
    >
      {props.files.map((file) => (
        <div key={`${file.path}:${file.uncommitted}`} className="flex flex-col gap-2">
          <h4 className="font-medium font-mono text-xs">{file.path}</h4>
          <FileDiff
            file={file}
            mode={props.mode}
            selection={props.selection}
            onPick={props.onPick}
          />
          {props.selection?.path === file.path && props.composer}
        </div>
      ))}
    </section>
  );
}
