import { inputSummary } from "../lib/tool-input.ts";

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
        <span className="tool-summary">{inputSummary(props.input)}</span>
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
