const SUMMARY_KEYS = ["file_path", "command", "pattern", "path", "url", "description"];

function summarize(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const record = input as Record<string, unknown>;
  const key = SUMMARY_KEYS.find((k) => typeof record[k] === "string");
  const text = key ? String(record[key]) : JSON.stringify(record);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/** Collapsed tool call: name and input summary; expands to the full input and its result. */
export function ToolCall(props: {
  name: string;
  input: unknown;
  result?: { content: string; isError: boolean };
}) {
  return (
    <details className="tool-call">
      <summary>
        <span className="tool-name">{props.name}</span>{" "}
        <span className="tool-summary">{summarize(props.input)}</span>
      </summary>
      <pre className="tool-input">{JSON.stringify(props.input, null, 2)}</pre>
      {props.result ? (
        <pre className={props.result.isError ? "tool-result error" : "tool-result"}>
          {props.result.content}
        </pre>
      ) : (
        <p className="muted">aguardando resultado…</p>
      )}
    </details>
  );
}
