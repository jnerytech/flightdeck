/** A tool call of a stored transcript: the tool and the most telling field of its input, in one line. */
export function ToolRow(props: { name: string; input: string; label: string }) {
  return (
    <figure
      aria-label={props.label}
      className="m-0 flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm"
    >
      <span className="font-medium font-mono text-xs">{props.name}</span>
      <span className="min-w-0 truncate text-muted-foreground text-xs">{props.input}</span>
    </figure>
  );
}
