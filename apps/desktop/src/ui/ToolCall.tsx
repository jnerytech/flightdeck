import { ChevronRight } from "lucide-react";
import { ToolCallBody } from "@/components/session/tool-call-body";
import { useT } from "@/i18n/context";
import { inputSummary } from "../lib/tool-input.ts";

/** Collapsed tool call: name and input summary; expands to the full input and its result. */
export function ToolCall(
  props: Readonly<{
    name: string;
    input: unknown;
    result?: { content: string; isError: boolean };
  }>,
) {
  const t = useT();
  return (
    <details className="group rounded-md border bg-card text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5">
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-90"
        />
        <span className="font-medium font-mono text-xs">{props.name}</span>{" "}
        <span className="min-w-0 truncate text-muted-foreground text-xs">
          {inputSummary(props.input)}
        </span>
      </summary>
      <ToolCallBody input={props.input} result={props.result} waiting={t("toolCall.waiting")} />
    </details>
  );
}
