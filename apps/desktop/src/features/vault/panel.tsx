import { type ReactNode, useEffect, useRef } from "react";

/** The controls a person can type in or press, in document order. */
const CONTROLS =
  "input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)";

/**
 * A panel that opens above the vault's tabs (New, Edit, Rules): its first control takes the focus
 * and it scrolls into view, and when it closes the focus goes back to the button that opened it
 * (#2604). The opener is named by its `data-opener` key, because the button may be a new element
 * by then (the New secret button is not rendered while its form is open). A panel the page opens by
 * itself (a rule from the approval screen) still goes back to its secret's button.
 */
export function VaultPanel(props: Readonly<{ opener: string; children: ReactNode }>) {
  const root = useRef<HTMLDivElement>(null);
  const { opener } = props;
  useEffect(() => {
    const panel = root.current;
    panel?.querySelector<HTMLElement>(CONTROLS)?.focus();
    panel?.firstElementChild?.scrollIntoView?.({ block: "nearest" });
    return () => {
      const button = [...document.querySelectorAll<HTMLElement>("[data-opener]")].find(
        (el) => el.dataset.opener === opener,
      );
      button?.focus();
    };
  }, [opener]);
  return <div ref={root}>{props.children}</div>;
}
