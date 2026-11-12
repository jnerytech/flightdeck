import { cn } from "@/lib/utils";

/**
 * What a tool call opens to: its whole input and its result (an error in red), or `waiting` while it
 * has none. The live call (`ToolCall`) and a stored one (`ToolRow`, #606) show the same.
 */
export function ToolCallBody(
  props: Readonly<{
    input: unknown;
    result: { content: string; isError: boolean } | null | undefined;
    waiting: string;
  }>,
) {
  return (
    <>
      <pre className="overflow-x-auto border-t bg-muted p-3 font-mono text-xs">
        {typeof props.input === "string" ? props.input : JSON.stringify(props.input, null, 2)}
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
        <p className="border-t px-3 py-2 text-muted-foreground text-xs">{props.waiting}</p>
      )}
    </>
  );
}
