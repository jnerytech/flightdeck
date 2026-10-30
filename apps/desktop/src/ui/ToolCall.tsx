import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputSummary } from "../lib/tool-input.ts";

/** Collapsed tool call: name and input summary; expands to the full input and its result. */
export function ToolCall(props: {
  name: string;
  input: unknown;
  result?: { content: string; isError: boolean };
}) {
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
      <pre className="overflow-x-auto border-t bg-muted p-3 font-mono text-xs">
        {JSON.stringify(props.input, null, 2)}
      </pre>
      {props.result ? (
        <pre
          className={cn(
            "overflow-x-auto border-t p-3 font-mono text-xs",
            props.result.isError && "text-status-error",
          )}
        >
          {props.result.content}
        </pre>
      ) : (
        <p className="border-t px-3 py-2 text-muted-foreground text-xs">aguardando resultado…</p>
      )}
    </details>
  );
}
