/** Why Update from the base was refused, in the host's words (they name the files in conflict). */
export function PrRefusal(props: Readonly<{ text: string }>) {
  return (
    <div
      role="alert"
      className="rounded-md border border-status-error/40 px-3 py-2 text-sm text-status-error"
    >
      {props.text}
    </div>
  );
}
