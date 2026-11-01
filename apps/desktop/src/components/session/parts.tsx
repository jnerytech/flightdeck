import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A session's title, its gray line and its controls, over the timeline. */
export function SessionHeader(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  controls?: ReactNode;
  /** A row of its own under the buttons (the persona controls). */
  extra?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
      <div className="min-w-0">
        <h2 className="truncate font-semibold text-base">{props.title}</h2>
        {props.subtitle && (
          <div className="flex flex-col text-muted-foreground text-xs">{props.subtitle}</div>
        )}
      </div>
      {props.controls && (
        <div data-slot="session-controls" className="flex flex-wrap items-end gap-2">
          {props.controls}
        </div>
      )}
      {props.extra && (
        <div data-slot="session-extra" className="basis-full">
          {props.extra}
        </div>
      )}
    </header>
  );
}

/** The conversation: scrolls by itself between the header and the composer. */
export const Timeline = forwardRef<
  HTMLDivElement,
  { children: ReactNode } & React.HTMLAttributes<HTMLDivElement>
>(function Timeline({ children, className, ...rest }, ref) {
  return (
    <div
      ref={ref}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a region that scrolls takes focus, so the keyboard reaches it
      tabIndex={0}
      className={cn("flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4", className)}
      {...rest}
    >
      {children}
    </div>
  );
});

/** One message: the user's in a soft bubble on the right, the assistant's plain. */
export function Message(props: {
  from: "user" | "assistant";
  children: ReactNode;
  className?: string;
  "data-uuid"?: string;
  "aria-current"?: "true";
}) {
  return (
    <div
      data-uuid={props["data-uuid"]}
      aria-current={props["aria-current"]}
      className={cn(
        "max-w-full break-words text-sm",
        props.from === "user"
          ? "self-end whitespace-pre-wrap rounded-lg bg-secondary px-3 py-2"
          : "flex flex-col gap-2",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

/** A line under the conversation: the message box and its button. */
export function Composer(props: { children: ReactNode }) {
  return <div className="flex items-end gap-2 border-t p-3">{props.children}</div>;
}

/** A session pane: header, timeline and composer stacked, filling its column. */
export function SessionPane(props: { children: ReactNode }) {
  return <section className="flex h-full min-h-0 flex-col">{props.children}</section>;
}
