import type { HistoryToolDetail } from "@flightdeck/protocol";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n/context";
import { cn } from "@/lib/utils";
import { ToolCallBody } from "./tool-call-body";

/** Reads a stored call's whole input and result: `null` when the transcript no longer has it. */
export type ToolLoad = () => Promise<HistoryToolDetail | null>;

/**
 * A tool call of a stored transcript: the tool and the most telling field of its input, in one line.
 * With `load` (a host that answers `history.tool`, #606) it opens, like a live call, to the whole
 * input and the result, read on the first open.
 */
export function ToolRow(
  props: Readonly<{ name: string; input: string; label: string; load?: ToolLoad | undefined }>,
) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<HistoryToolDetail | null | "loading" | undefined>();
  const { load } = props;
  const line = (
    <>
      <span className="font-medium font-mono text-xs">{props.name}</span>
      <span className="min-w-0 truncate text-muted-foreground text-xs">{props.input}</span>
    </>
  );
  if (!load) {
    return (
      <figure
        aria-label={props.label}
        className="m-0 flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm"
      >
        {line}
      </figure>
    );
  }
  const toggle = () => {
    setOpen(!open);
    if (detail !== undefined) return;
    setDetail("loading");
    void load().then(setDetail, () => setDetail(null));
  };
  const note = (text: string) => (
    <p className="border-t px-3 py-2 text-muted-foreground text-xs">{text}</p>
  );
  const body = () => {
    if (detail === "loading" || detail === undefined) return note(t("reader.toolLoading"));
    if (detail === null) return note(t("reader.toolMissing"));
    return (
      <>
        <ToolCallBody
          input={detail.input}
          result={detail.result}
          waiting={t("reader.toolNoResult")}
        />
        {detail.truncated && note(t("reader.toolTruncated"))}
      </>
    );
  };
  return (
    <figure aria-label={props.label} className="m-0 rounded-md border bg-card text-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
            open && "rotate-90",
          )}
        />
        {line}
      </button>
      {open && body()}
    </figure>
  );
}
