/**
 * What a workflow gate asks and what it shows (its `show`), so it is approved in sight of it: on
 * the run's timeline and in the Needs you pane alike (issue #245). A long output scrolls.
 */
export function GateText(props: { message: string; output?: string | null }) {
  return (
    <>
      <p>{props.message}</p>
      {props.output && (
        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">
          {props.output}
        </pre>
      )}
    </>
  );
}
