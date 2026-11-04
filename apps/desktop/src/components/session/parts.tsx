import { MoreHorizontal } from "lucide-react";
import { forwardRef, type ReactNode, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/i18n/context";
import { useWidth } from "@/lib/use-width";
import { cn } from "@/lib/utils";

/** Below this width of the header's own box it is one line and the actions fold into a menu. */
const NARROW_HEADER = 560;

/** A session's title, its gray line and its controls, over the timeline. */
export function SessionHeader(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  controls?: ReactNode;
  /** A row of its own under the buttons (the persona controls). */
  extra?: ReactNode;
  /** The buttons that fold into a "More actions" menu when the header is narrow. */
  actions?: ReactNode;
  /** Dialogs of the actions: they stay mounted whether the menu is open or not. */
  dialogs?: ReactNode;
  /** The path and cost as one line of text: the tooltip of the title when the header is narrow. */
  hint?: string;
}) {
  const t = useT();
  const box = useRef<HTMLElement>(null);
  const width = useWidth(box);
  const narrow = width > 0 && width < NARROW_HEADER;
  if (narrow) {
    return (
      <header
        ref={box}
        className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2"
      >
        <h2 title={props.hint} className="min-w-0 flex-1 truncate font-semibold text-base">
          {props.title}
        </h2>
        <div data-slot="session-controls" className="flex shrink-0 items-center gap-2">
          {props.controls}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t("session.moreActions")}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="flex w-auto max-w-[calc(100vw-2rem)] flex-col gap-2"
            >
              {props.actions}
              {props.extra}
            </PopoverContent>
          </Popover>
          {props.dialogs}
        </div>
      </header>
    );
  }
  return (
    <header
      ref={box}
      className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b px-4 py-3"
    >
      <div className="min-w-0">
        <h2 className="truncate font-semibold text-base">{props.title}</h2>
        {props.subtitle && (
          <div className="flex flex-col text-muted-foreground text-xs">{props.subtitle}</div>
        )}
      </div>
      {(props.controls || props.actions || props.dialogs) && (
        <div data-slot="session-controls" className="flex flex-wrap items-end gap-2">
          {props.controls}
          {props.actions}
          {props.dialogs}
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
      data-slot="timeline"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a region that scrolls takes focus, so the keyboard reaches it
      tabIndex={0}
      className={cn(
        // The items never shrink: in a column that scrolls they would squash into each other.
        "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 [&>*]:shrink-0",
        className,
      )}
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
        "message-hover max-w-full break-words text-sm",
        props.from === "user"
          ? "self-end whitespace-pre-wrap rounded-lg bg-secondary px-3 py-2"
          : "message-prose flex flex-col gap-2",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

/** Under the conversation: what waits to go out, the activity line, the box and its state line. */
export function ComposerDock(props: { children: ReactNode }) {
  return <div className="composer-dock">{props.children}</div>;
}

/** The floating rounded card of the message box and its buttons. */
export function Composer(props: { children: ReactNode }) {
  return (
    <div data-slot="composer-card" className="composer-card">
      {props.children}
    </div>
  );
}

/** A session pane: header, timeline and composer stacked, filling its column. */
export function SessionPane(props: { children: ReactNode }) {
  return <section className="flex h-full min-h-0 flex-col">{props.children}</section>;
}
