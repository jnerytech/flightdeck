import type { DiffFile, ReviewComment } from "@flightdeck/protocol";
import { MessageSquarePlus } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { cn } from "@/lib/utils";
import { formatBytes } from "../lib/format-bytes.ts";
import { type DiffRow, diffRows, type Selection, selected } from "../lib/review.ts";

type LineRow = Extract<DiffRow, { kind: "line" }>;

/** Whole class names, so Tailwind finds them. */
const TONE = {
  "+": "bg-status-running/10",
  "-": "bg-status-error/10",
  " ": "",
} as const;

/** How a line's number looks, as a button or as plain text. */
const NUMBER = "w-10 shrink-0 select-none px-1 text-right text-muted-foreground tabular-nums";

/** Arrows, Home and End move between the line numbers of one file's diff (#1177). */
function moveBetweenLines(e: KeyboardEvent<HTMLButtonElement>) {
  // A modified key keeps its own meaning: Alt+Arrow goes back, Ctrl+Home scrolls to the top.
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const numbers = [
    ...(e.currentTarget
      .closest("table")
      ?.querySelectorAll<HTMLButtonElement>("button[data-line-number]") ?? []),
  ];
  const at = numbers.indexOf(e.currentTarget);
  const to = {
    ArrowDown: Math.min(at + 1, numbers.length - 1),
    ArrowUp: Math.max(at - 1, 0),
    Home: 0,
    End: numbers.length - 1,
  }[e.key];
  if (to === undefined || at < 0) return;
  e.preventDefault();
  numbers[to]?.focus();
}

/** The number of a line, a button that starts (or, with shift, extends) a comment on it. */
function LineNumber(
  props: Readonly<{
    path: string;
    side: ReviewComment["side"];
    line: number;
    picked: boolean;
    /** The file's one Tab stop (#1177): the others are reached with the arrows. */
    tabbable: boolean;
    onFocus(): void;
    /** Starts a comment on a line; without it the numbers are plain text. */
    onPick?(path: string, side: ReviewComment["side"], line: number, extend: boolean): void;
  }>,
) {
  const t = useT();
  const key = props.side === "old" ? "changes.commentOldLine" : "changes.commentLine";
  const pick = props.onPick;
  const label = t(key, { line: props.line, path: props.path });
  if (!pick) {
    return <span className={NUMBER}>{props.line}</span>;
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={props.picked}
      data-line-number=""
      tabIndex={props.tabbable ? 0 : -1}
      onFocus={props.onFocus}
      onKeyDown={moveBetweenLines}
      className={cn(
        NUMBER,
        "group hit-24 hover:text-foreground aria-pressed:text-foreground focus-visible:text-foreground",
      )}
      onClick={(e) => pick(props.path, props.side, props.line, e.shiftKey)}
    >
      {/* On hover and focus the number gives way to the Comment mark: a line can be commented. */}
      <span className="group-hover:hidden group-focus-visible:hidden">{props.line}</span>
      <MessageSquarePlus
        data-slot="comment-affordance"
        aria-hidden="true"
        className="ml-auto hidden size-4 group-hover:block group-focus-visible:block"
      />
    </button>
  );
}

/** One file's diff: its lines numbered and clickable, unified or side by side. */
function FileDiff(
  props: Readonly<{
    file: DiffFile;
    mode: "unified" | "split";
    selection: Selection | null;
    /** Starts a comment on a line; without it the numbers are plain text. */
    onPick?(path: string, side: ReviewComment["side"], line: number, extend: boolean): void;
    onShowInFolder?: (file: DiffFile) => void;
  }>,
) {
  const t = useT();
  const { file, selection, onPick } = props;
  const path = file.path;
  const rows = diffRows(file);
  // #1177: the file is one Tab stop: the line last focused, else the picked one, else the first.
  const [focused, setFocused] = useState<string | null>(null);
  if (file.secret) {
    return <p className="text-muted-foreground text-xs">{t("changes.secretNote")}</p>;
  }
  if (file.binary) {
    return <p className="text-muted-foreground text-xs">{t("changes.binaryNote")}</p>;
  }
  if (file.tooLarge) {
    return (
      <div className="row-wrap">
        <p className="text-muted-foreground text-xs">
          {file.bytes === undefined
            ? t("changes.tooLargeNoteNoSize")
            : t("changes.tooLargeNote", { size: formatBytes(file.bytes) })}
        </p>
        {props.onShowInFolder && file.status !== "deleted" && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t("changes.showInFolderLabel", { path })}
            onClick={() => props.onShowInFolder?.(file)}
          >
            {t("changes.showInFolder")}
          </Button>
        )}
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="text-muted-foreground text-xs">{t("changes.noLines")}</p>;
  }
  const lineOf = (row: LineRow, side: ReviewComment["side"]) =>
    (side === "old" ? row.oldLine : row.newLine) as number;
  // Every number in the order the rows show them: the old side before the new in a split row.
  const numbers = rows.flatMap((row) => {
    if (row.kind !== "line") return [];
    const sides: ReviewComment["side"][] =
      props.mode === "unified" ? [row.op === "-" ? "old" : "new"] : [];
    if (props.mode === "split" && row.op !== "+") sides.push("old");
    if (props.mode === "split" && row.op !== "-") sides.push("new");
    return sides.map((side) => ({ side, line: lineOf(row, side) }));
  });
  const keyOf = (side: ReviewComment["side"], line: number) => `${side}:${line}`;
  const keys = numbers.map((n) => keyOf(n.side, n.line));
  const picked = numbers.find((n) => selected(selection, path, n.side, n.line));
  const stop =
    focused !== null && keys.includes(focused)
      ? focused
      : picked
        ? keyOf(picked.side, picked.line)
        : keys[0];
  const number = (row: LineRow, side: ReviewComment["side"]) => {
    const line = lineOf(row, side);
    const key = keyOf(side, line);
    return (
      <LineNumber
        path={path}
        side={side}
        line={line}
        picked={selected(selection, path, side, line)}
        tabbable={key === stop}
        onFocus={() => setFocused(key)}
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
      <tbody>{rows.map((row, i) => renderRow(row, i))}</tbody>
    </table>
  );
}

/** The changes of every file, stacked: each with its numbered lines and the open composer. */
export function DiffView(
  props: Readonly<{
    files: DiffFile[];
    mode: "unified" | "split";
    selection: Selection | null;
    /** Starts a comment on a line; without it the numbers are plain text. */
    onPick?(path: string, side: ReviewComment["side"], line: number, extend: boolean): void;
    /** The form to comment on the selection; shown under the file it belongs to. */
    composer: ReactNode;
    /** Shows a file in the system's file manager; absent where the app cannot (a browser, a remote host). */
    onShowInFolder?: (file: DiffFile) => void;
  }>,
) {
  const t = useT();
  return (
    <section
      aria-label={props.mode === "unified" ? t("diff.unifiedLabel") : t("diff.splitLabel")}
      className="flex flex-col gap-4"
    >
      {/* #1177: the comment mark shows only on hover or focus, so the view says how to comment. */}
      {props.onPick && props.files.length > 0 && (
        <p className="text-muted-foreground text-xs">{t("changes.commentHint")}</p>
      )}
      {props.files.map((file) => (
        <div key={`${file.path}:${file.uncommitted}`} className="flex flex-col gap-2">
          <h4 className="font-medium font-mono text-xs">{file.path}</h4>
          <FileDiff
            file={file}
            mode={props.mode}
            selection={props.selection}
            onPick={props.onPick}
            {...(props.onShowInFolder ? { onShowInFolder: props.onShowInFolder } : {})}
          />
          {props.selection?.path === file.path && props.composer}
        </div>
      ))}
    </section>
  );
}
