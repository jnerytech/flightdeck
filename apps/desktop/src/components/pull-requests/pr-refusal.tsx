import { useEffect, useRef } from "react";

/**
 * Why Update from the base was refused, in the host's words (they name the files in conflict). It
 * takes the focus when it appears, a tick later, as the merge refusal does: the row that was
 * clicked may be far from the top of the page.
 */
export function PrRefusal(props: Readonly<{ text: string }>) {
  const box = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new refusal text is the trigger to focus again
  useEffect(() => {
    const timer = setTimeout(() => box.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [props.text]);
  return (
    <div
      role="alert"
      ref={box}
      tabIndex={-1}
      className="rounded-md border border-status-error/40 px-3 py-2 text-sm text-status-error focus-visible:outline-2 focus-visible:outline-ring"
    >
      {props.text}
    </div>
  );
}
